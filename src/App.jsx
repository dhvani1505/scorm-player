import { useState } from "react";
import "./App.css";

// --------------------------------------------------
// SCORM 2004 API
// --------------------------------------------------

function createSCORM2004API() {
  let initialized = false;
  let terminated = false;
  let lastError = "0";

  const data = {
    "cmi.completion_status": "incomplete",
    "cmi.success_status": "unknown",
    "cmi.score.scaled": "",
    "cmi.score.raw": "",
    "cmi.score.min": "",
    "cmi.score.max": "",
    "cmi.location": "",
    "cmi.suspend_data": "",
    "cmi.exit": "",
    "cmi.entry": "ab-initio",
    "cmi.session_time": "PT0S",
    "cmi.total_time": "PT0S",
    "cmi.credit": "credit",
    "cmi.mode": "normal",
    "cmi.launch_data": "",
    "cmi.learner_id": "local-learner",
    "cmi.learner_name": "Local Learner",
    "cmi.progress_measure": "",
    "cmi.scaled_passing_score": "",
  };

  const startTime = Date.now();

  function getError(code) {
    lastError = String(code);
    return lastError;
  }

  const api = {
    Initialize(parameter) {
      if (parameter !== "") {
        return getError("201");
      }

      if (initialized || terminated) {
        return getError("103");
      }

      initialized = true;

      return getError("0") === "0" ? "true" : "false";
    },

    Terminate(parameter) {
      if (parameter !== "") {
        return getError("201") && "false";
      }

      if (!initialized || terminated) {
        getError("112");
        return "false";
      }

      data["cmi.session_time"] = `PT${(
        (Date.now() - startTime) /
        1000
      ).toFixed(2)}S`;

      terminated = true;
      initialized = false;

      return "true";
    },

    GetValue(element) {
      if (!initialized) {
        getError("122");
        return "";
      }

      if (!(element in data)) {
        getError("401");
        return "";
      }

      getError("0");

      return data[element];
    },

    SetValue(element, value) {
      if (!initialized) {
        getError("132");
        return "false";
      }

      if (!(element in data)) {
        getError("401");
        return "false";
      }

      data[element] = String(value);

      getError("0");

      return "true";
    },

    Commit(parameter) {
      if (parameter !== "") {
        getError("201");
        return "false";
      }

      if (!initialized) {
        getError("142");
        return "false";
      }

      getError("0");

      return "true";
    },

    GetLastError() {
      return lastError;
    },

    GetErrorString(errorCode) {
      const errors = {
        "0": "No error",
        "101": "General exception",
        "102": "General initialization failure",
        "103": "Already initialized",
        "104": "Content instance terminated",
        "112": "Termination before initialization",
        "122": "Retrieve data before initialization",
        "132": "Store data before initialization",
        "142": "Commit before initialization",
        "201": "Invalid argument",
        "301": "General set failure",
        "401": "Undefined data model element",
      };

      return errors[String(errorCode)] || "Unknown error";
    },

    GetDiagnostic(errorCode) {
      return this.GetErrorString(errorCode);
    },
  };

  return api;
}

// --------------------------------------------------
// React Application
// --------------------------------------------------

function App() {
  const [selectedFile, setSelectedFile] = useState(null);
  const [courseInfo, setCourseInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [playCourse, setPlayCourse] = useState(false);

  // Handle ZIP file selection
  function handleFileChange(event) {
    const file = event.target.files[0];

    setSelectedFile(file || null);
    setCourseInfo(null);
    setPlayCourse(false);
    setError("");
  }

  // Upload SCORM ZIP
  async function handleUpload() {
    if (!selectedFile) {
      setError("Please select a SCORM ZIP file.");
      return;
    }

    try {
      setLoading(true);
      setError("");
      setCourseInfo(null);
      setPlayCourse(false);

      const formData = new FormData();

      formData.append("scormFile", selectedFile);

      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result.message || "Course upload failed."
        );
      }

      setCourseInfo({
        fileName: selectedFile.name,
        courseId: result.courseId,
        courseUrl: result.courseUrl,
        launchFile: result.launchFile,
      });

    } catch (err) {
      console.error("Upload error:", err);

      setError(
        err.message ||
          "Unable to upload the course."
      );

    } finally {
      setLoading(false);
    }
  }

  // Launch SCORM course
  function handlePlayCourse() {
    if (!courseInfo) {
      return;
    }

    // Install SCORM 2004 API on the parent window.
    // The SCORM course must be same-origin to access it.
    window.API_1484_11 = createSCORM2004API();

    // Launch the course
    setPlayCourse(true);
  }

  // Return to upload/course information
  function handleBack() {
    setPlayCourse(false);
  }

  // Reset player
  function handleReset() {
    setSelectedFile(null);
    setCourseInfo(null);
    setPlayCourse(false);
    setError("");

    const fileInput = document.getElementById("scormFile");

    if (fileInput) {
      fileInput.value = "";
    }
  }

  return (
    <div className="app">

      {/* Header */}
      <header className="header">
        <h1>SCORM Player</h1>

        <p>
          Upload and play your e-learning courses
        </p>
      </header>

      <main className="main">

        {/* Upload screen */}
        {!playCourse && (
          <div className="upload-container">

            <h2>Upload Your Course</h2>

            <p className="description">
              Select a SCORM ZIP file from your computer.
            </p>

            {/* File selection */}
            <div className="upload-box">

              <div className="upload-icon">
                ↑
              </div>

              <label
                htmlFor="scormFile"
                className="upload-label"
              >
                Choose SCORM ZIP
              </label>

              <input
                type="file"
                id="scormFile"
                accept=".zip,application/zip"
                onChange={handleFileChange}
              />

              <p className="file-info">
                {selectedFile
                  ? selectedFile.name
                  : "Supported format: .zip"}
              </p>

            </div>

            {/* Upload button */}
            <button
              className="upload-button"
              onClick={handleUpload}
              disabled={!selectedFile || loading}
            >
              {loading
                ? "Uploading Course..."
                : "Upload Course"}
            </button>

            {/* Error */}
            {error && (
              <p className="error-message">
                {error}
              </p>
            )}

            {/* Course details */}
            {courseInfo && (
              <div className="course-info">

                <h2>Course Information</h2>

                <p>
                  <strong>ZIP File:</strong>{" "}
                  {courseInfo.fileName}
                </p>

                <p>
                  <strong>Course ID:</strong>{" "}
                  {courseInfo.courseId}
                </p>

                <p>
                  <strong>Status:</strong>{" "}
                  Uploaded and extracted successfully
                </p>

                <p>
                  <strong>Launch File:</strong>{" "}
                  {courseInfo.launchFile}
                </p>

                {/* Play course */}
                <button
                  className="upload-button"
                  onClick={handlePlayCourse}
                >
                  Play Course
                </button>

                {/* Upload another */}
                <button
                  className="reset-button"
                  onClick={handleReset}
                >
                  Upload Another Course
                </button>

              </div>
            )}

          </div>
        )}

        {/* Course player */}
        {playCourse && courseInfo && (
          <div className="player-container">

            {/* Player header */}
            <div className="player-header">

              <div>
                <h2>Course Player</h2>

                <p>
                  {courseInfo.fileName}
                </p>
              </div>

              <button
                className="back-button"
                onClick={handleBack}
              >
                Back to Course
              </button>

            </div>

            {/* SCORM course iframe */}
            <iframe
              key={courseInfo.courseId}
              src={courseInfo.courseUrl}
              title="SCORM Course"
              className="scorm-iframe"
              allowFullScreen
            />

          </div>
        )}

      </main>

    </div>
  );
}

export default App;