const express = require("express");
const multer = require("multer");
const AdmZip = require("adm-zip");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();

const PORT = 5000;

// --------------------------------------------------
// Middleware
// --------------------------------------------------

app.use(cors());

app.use(express.json());

// --------------------------------------------------
// Upload folder
// --------------------------------------------------

const uploadFolder = path.join(__dirname, "uploads");

if (!fs.existsSync(uploadFolder)) {
  fs.mkdirSync(uploadFolder, {
    recursive: true,
  });
}

// --------------------------------------------------
// Multer configuration
// --------------------------------------------------

const storage = multer.memoryStorage();

const upload = multer({
  storage: storage,

  limits: {
    fileSize: 500 * 1024 * 1024,
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
// Upload and extract SCORM ZIP
// --------------------------------------------------

app.post(
  "/api/upload",
  upload.single("scormFile"),
  (req, res) => {
    try {
      // Check whether file was uploaded
      if (!req.file) {
        return res.status(400).json({
          message: "Please upload a SCORM ZIP file.",
        });
      }

      // Generate unique course ID
      const courseId = Date.now().toString();

      // Create course directory
      const courseFolder = path.join(
        uploadFolder,
        courseId
      );

      fs.mkdirSync(courseFolder, {
        recursive: true,
      });

      // Read uploaded ZIP
      const zip = new AdmZip(req.file.buffer);

      // Extract ZIP contents
      zip.extractAllTo(courseFolder, true);

      // Locate SCORM manifest
      const manifestPath = path.join(
        courseFolder,
        "imsmanifest.xml"
      );

      // Check manifest exists
      if (!fs.existsSync(manifestPath)) {
        fs.rmSync(courseFolder, {
          recursive: true,
          force: true,
        });

        return res.status(400).json({
          message:
            "SCORM manifest imsmanifest.xml was not found in the ZIP root.",
        });
      }

      // Read manifest XML
      const manifestContent = fs.readFileSync(
        manifestPath,
        "utf-8"
      );

      // Find launch file
      const launchMatch = manifestContent.match(
        /<resource\b[^>]*\bhref=["']([^"']+)["']/i
      );

      let launchFile = "index.html";

      if (launchMatch && launchMatch[1]) {
        launchFile = launchMatch[1];
      }

      // Construct course URL
      const courseUrl = `/courses/${courseId}/${launchFile}`;

      // Count extracted files
      function countFiles(directory) {
        let total = 0;

        const entries = fs.readdirSync(directory, {
          withFileTypes: true,
        });

        for (const entry of entries) {
          const entryPath = path.join(
            directory,
            entry.name
          );

          if (entry.isDirectory()) {
            total += countFiles(entryPath);
          } else {
            total++;
          }
        }

        return total;
      }

      const totalFiles = countFiles(courseFolder);

      // Return success response
      res.status(200).json({
        message: "SCORM uploaded and extracted successfully",

        courseId: courseId,

        fileName: req.file.originalname,

        totalFiles: totalFiles,

        manifest: "imsmanifest.xml",

        launchFile: launchFile,

        courseUrl: courseUrl,
      });

    } catch (error) {
      console.error("SCORM upload error:", error);

      res.status(500).json({
        message:
          "An error occurred while uploading or extracting the SCORM ZIP.",
      });
    }
  }
);

// --------------------------------------------------
// Serve extracted SCORM files
// --------------------------------------------------

app.use(
  "/courses",
  express.static(uploadFolder)
);

// --------------------------------------------------
// Error handling
// --------------------------------------------------

app.use((error, req, res, next) => {
  console.error("Backend error:", error.message);

  if (error instanceof multer.MulterError) {
    return res.status(400).json({
      message:
        error.code === "LIMIT_FILE_SIZE"
          ? "ZIP file is too large. Maximum allowed size is 500 MB."
          : error.message,
    });
  }

  res.status(500).json({
    message: error.message || "Internal server error.",
  });
});

// --------------------------------------------------
// Start backend server
// --------------------------------------------------

app.listen(PORT, () => {
  console.log(
    `SCORM backend running on http://localhost:${PORT}`
  );
});