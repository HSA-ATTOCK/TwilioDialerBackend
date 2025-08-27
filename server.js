const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const dotenv = require("dotenv");

// Load environment variables
dotenv.config();

const app = express();

// Enhanced CORS configuration
app.use(
  cors({
    origin: [
      "http://localhost:3000", // local frontend (dev)
      "http://localhost:3001", // another local frontend
      /\.onrender\.com$/, // allow any frontend hosted on Render
      /\.vercel\.app$/, // allow any frontend hosted on Vercel
      /\.netlify\.app$/, // allow Netlify deployments
      /\.ngrok\.io$/, // allow ngrok tunnels for development
      process.env.FRONTEND_URL, // specific frontend URL from env
    ].filter(Boolean), // Remove undefined values
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "ngrok-skip-browser-warning",
    ],
  })
);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // Important for Twilio webhooks

// Import routes
const { router: authRouter, authMiddleware } = require("./routes/auth");
const twilioRouter = require("./routes/twilio");
const dialRouter = require("./routes/dial");
const recordingRouter = require("./routes/recording");
const organizationRouter = require("./routes/organization");
const platformAdminRouter = require("./routes/platformAdmin");

// Database connection
mongoose
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("✅ MongoDB connected successfully"))
  .catch((err) => {
    console.error("❌ MongoDB connection error:", err.message);
    process.exit(1);
  });

// Health check endpoint
app.get("/health", (req, res) => {
  const twilioConfigured = !!(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_API_KEY &&
    process.env.TWILIO_API_SECRET &&
    process.env.TWILIO_TWIML_APP_SID
  );

  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development",
    database:
      mongoose.connection.readyState === 1 ? "connected" : "disconnected",
    twilioConfigured,
    server: "running",
  });
});

// API Routes
app.use("/auth", authRouter);
app.use("/organization", organizationRouter);
app.use("/platform-admin", platformAdminRouter); // Platform admin routes
app.use("/twilio", twilioRouter); // No authentication required for Twilio webhooks
app.use("/dial", authMiddleware, dialRouter); // Protected routes for dial operations
app.use("/recording", authMiddleware, recordingRouter); // Protected routes for recording operations

// Test endpoint
app.get("/test", (req, res) => {
  res.json({
    message: "Server is working!",
    timestamp: new Date().toISOString(),
  });
});

// Environment validation
const requiredEnvVars = [
  "MONGO_URI",
  "JWT_SECRET",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_API_KEY",
  "TWILIO_API_SECRET",
  "TWILIO_TWIML_APP_SID",
  "TWILIO_PHONE_NUMBER",
];

const missingEnvVars = requiredEnvVars.filter(
  (varName) => !process.env[varName]
);

if (missingEnvVars.length > 0) {
  console.error("❌ Missing required environment variables:");
  missingEnvVars.forEach((varName) => {
    console.error(`   - ${varName}`);
  });
  console.error("\nPlease set these variables in your .env file");
}

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Server error:", err);
  res.status(500).json({
    error: "Internal server error",
    message:
      process.env.NODE_ENV === "development"
        ? err.message
        : "Something went wrong",
    timestamp: new Date().toISOString(),
  });
});

// 404 handler
app.use("*", (req, res) => {
  res.status(404).json({
    error: "Endpoint not found",
    path: req.originalUrl,
    method: req.method,
    timestamp: new Date().toISOString(),
  });
});

// Start server
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`\n🚀 Server running on port ${PORT}`);
  console.log(`📍 Environment: ${process.env.NODE_ENV || "development"}`);

  if (process.env.NODE_ENV === "development") {
    console.log(`🌐 Local URL: http://localhost:${PORT}`);
    console.log(`🔍 Health check: http://localhost:${PORT}/health`);
  }

  // Environment validation summary
  if (missingEnvVars.length === 0) {
    console.log("✅ All required environment variables are present");
    console.log("✅ Server ready for Twilio Voice calls");
  } else {
    console.log("⚠️  Some environment variables are missing");
    console.log("⚠️  Twilio functionality may not work properly");
  }

  console.log("\n📋 Available routes:");
  console.log("   GET  /health - Health check");
  console.log("   POST /auth/login - User authentication");
  console.log("   GET  /twilio/access-token - Twilio access token");
  console.log("   POST /twilio/outbound-twiml - Twilio outbound calls");
  console.log("   POST /dial/* - Protected dial operations");
  console.log("");
});

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\n🛑 Received SIGINT, shutting down gracefully...");
  mongoose.connection.close(() => {
    console.log("✅ Database connection closed");
    process.exit(0);
  });
});

process.on("SIGTERM", () => {
  console.log("\n🛑 Received SIGTERM, shutting down gracefully...");
  mongoose.connection.close(() => {
    console.log("✅ Database connection closed");
    process.exit(0);
  });
});

// Handle uncaught exceptions
process.on("uncaughtException", (err) => {
  console.error("❌ Uncaught Exception:", err.message);
  console.error(err.stack);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("❌ Unhandled Rejection at:", promise, "reason:", reason);
  process.exit(1);
});

module.exports = app;
