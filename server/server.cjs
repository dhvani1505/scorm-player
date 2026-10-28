
require("dotenv").config();

const express = require("express");
const multer = require("multer");
const AdmZip = require("adm-zip");
const cors = require("cors");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 5000;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const BUCKET_NAME = "scorm-courses";

// --------------------------------------------------
// Supabase connection
// --------------------------------------------------

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Supabase environment variables are missing.");
  process.exit(1);
}

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
);

// --------------------------------------------------
// Middleware
// --------------------------------------------------

app.use(cors());
app.use(express.json());

// --------------------------------------------------
// Multer configuration
// --------------------------------------------------

const upload = multer({
  storage: multer.memoryStorage(),

  limits: {
    fileSize: 100 * 1024 * 1024,
  },

  fileFilter: (req, file, callback) => {
    const isZip =
      path.extname(file.originalname).toLowerCase() === ".zip";

    if (isZip) {
      callback(null, true);
    } else {
      callback(new Error("Only ZIP files are allowed."));
    }
  },
});

// --------------------------------------------------
// Health check
// --------------------------------------------------

app.get("/", (req, res) => {
  res.json({
    message: "SCORM Player Backend is running",
  });
});

// --------------------------------------------------
// Upload SCORM ZIP and store files in Supabase
// --------------------------------------------------

app.post(
  "/api/upload",
  upload.single("scormFile"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          message: "Please upload a SCORM ZIP file.",
        });
      }

      // Read uploaded ZIP
      const zip = new AdmZip(req.file.buffer);
      const entries = zip.getEntries();

      // Find SCORM manifest in ZIP root
      const manifestEntry = entries.find(
        (entry) =>
          !entry.isDirectory &&
          entry.entryName.replace(/\\/g, "/") ===
            "imsmanifest.xml"
      );

      if (!manifestEntry) {
        return res.status(400).json({
          message:
            "SCORM manifest imsmanifest.xml was not found in the ZIP root. Upload an individual SCORM course ZIP.",
        });
      }

      // Read manifest XML
      const manifestContent =
        manifestEntry.getData().toString("utf8");

      // Find launch file from manifest
      const launchMatch = manifestContent.match(
        /<resource\b[^>]*\bhref=["']([^"']+)["']/i
      );

      if (!launchMatch || !launchMatch[1]) {
        return res.status(400).json({
          message:
            "Could not find the SCORM launch file in the manifest.",
        });
      }

      const launchFile = launchMatch[1].replace(/\\/g, "/");

      // Validate launch file path
      if (
        launchFile.startsWith("/") ||
        launchFile.split("/").includes("..")
      ) {
        return res.status(400).json({
          message: "Invalid SCORM launch file path.",
        });
      }

      // Generate unique course ID
      const courseId = `${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;

      let totalFiles = 0;

      // Upload extracted files to Supabase Storage
      for (const entry of entries) {
        if (entry.isDirectory) {
          continue;
        }

        const relativePath = entry.entryName.replace(/\\/g, "/");

        // Prevent unsafe paths
        if (
          relativePath.startsWith("/") ||
          relativePath.split("/").includes("..")
        ) {
          throw new Error(
            "ZIP contains an unsafe file path."
          );
        }

        const storagePath = `${courseId}/${relativePath}`;
        const fileBuffer = entry.getData();

        const { error } = await supabase.storage
          .from(BUCKET_NAME)
          .upload(storagePath, fileBuffer, {
            contentType: getContentType(relativePath),
            upsert: false,
          });

        if (error) {
          throw new Error(
            `Failed to upload ${relativePath}: ${error.message}`
          );
        }

        totalFiles++;
      }

      // Course launch URL
      const courseUrl = `/courses/${courseId}/${launchFile}`;

      return res.status(200).json({
        message: "SCORM uploaded successfully.",
        courseId,
        fileName: req.file.originalname,
        totalFiles,
        manifest: "imsmanifest.xml",
        launchFile,
        courseUrl,
      });
    } catch (error) {
      console.error("SCORM upload error:", error);

      return res.status(500).json({
        message:
          error.message ||
          "An error occurred while uploading the SCORM ZIP.",
      });
    }
  }
);

// --------------------------------------------------
// Serve SCORM course files from Supabase
// Express 5 wildcard route syntax
// --------------------------------------------------

app.get("/courses/:courseId/*filePath", async (req, res) => {
  try {
    const courseId = req.params.courseId;

    // Express 5 wildcard parameter is an array
    const filePath = req.params.filePath;

    if (
      !courseId ||
      !Array.isArray(filePath) ||
      filePath.length === 0
    ) {
      return res.status(400).send(
        "Invalid course file path."
      );
    }

    // Convert wildcard array to a path string
    const relativePath = filePath.join("/");

    // Prevent path traversal
    if (
      relativePath.startsWith("/") ||
      relativePath.split("/").includes("..")
    ) {
      return res.status(400).send(
        "Invalid course file path."
      );
    }

    const storagePath = `${courseId}/${relativePath}`;

    // Download requested file from Supabase
    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .download(storagePath);

    if (error || !data) {
      console.error(
        "Supabase download error:",
        error
      );

      return res.status(404).send(
        "Course file not found."
      );
    }

    // Set content type
    res.setHeader(
      "Content-Type",
      getContentType(relativePath)
    );

    res.setHeader(
      "Cache-Control",
      "public, max-age=3600"
    );

    // Convert downloaded file to Buffer
    const buffer = Buffer.from(
      await data.arrayBuffer()
    );

    return res.send(buffer);
  } catch (error) {
    console.error("Course file error:", error);

    return res.status(500).send(
      "Unable to load course file."
    );
  }
});

// --------------------------------------------------
// Content type helper
// --------------------------------------------------

function getContentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();

  const contentTypes = {
    ".html": "text/html",
    ".htm": "text/html",
    ".js": "application/javascript",
    ".mjs": "application/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".xml": "application/xml",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".mp3": "audio/mpeg",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".ogg": "audio/ogg",
    ".wav": "audio/wav",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".otf": "font/otf",
    ".pdf": "application/pdf",
  };

  return (
    contentTypes[extension] ||
    "application/octet-stream"
  );
}

// --------------------------------------------------
// Error handling
// --------------------------------------------------

app.use((error, req, res, next) => {
  console.error("Backend error:", error.message);

  if (error instanceof multer.MulterError) {
    return res.status(400).json({
      message:
        error.code === "LIMIT_FILE_SIZE"
          ? "ZIP file is too large. Maximum allowed size is 100 MB."
          : error.message,
    });
  }

  return res.status(500).json({
    message:
      error.message ||
      "Internal server error.",
  });
});

// --------------------------------------------------
// Start backend
// --------------------------------------------------

app.listen(PORT, () => {
  console.log(
    `SCORM backend running on port ${PORT}`
  );
});
