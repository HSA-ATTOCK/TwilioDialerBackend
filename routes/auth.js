const express = require("express");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const router = express.Router();

// Middleware to verify JWT and activeToken (add to protected routes)
// Middleware to verify JWT and activeToken (add to protected routes)
const verifyToken = async (req, res, next) => {
  console.log("=== VERIFY TOKEN MIDDLEWARE ===");
  console.log("Authorization header:", req.headers.authorization);

  const token = req.headers.authorization?.split(" ")[1]; // Bearer token
  console.log("Extracted token:", token);

  if (!token) {
    console.log("No token provided");
    return res.status(401).json({ error: "No token" });
  }

  try {
    console.log("Verifying token with JWT_SECRET...");
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log("Token decoded:", decoded);

    console.log("Looking up user with ID:", decoded.id);
    const user = await User.findById(decoded.id);
    console.log("User found:", user ? user.username : "null");
    console.log("User active token:", user?.activeToken);
    console.log("Token match:", user?.activeToken === token);

    if (!user || user.activeToken !== token) {
      console.log("User not found or token mismatch");
      return res
        .status(401)
        .json({ error: "Invalid or expired session. Login again." });
    }

    console.log("Token verification successful for user:", user.username);
    req.user = user;
    next();
  } catch (e) {
    console.error("Token verification error:", e);
    res.status(401).json({ error: "Token error" });
  }
};

// Verify token and return role and user ID
router.get("/verify", verifyToken, (req, res) => {
  // Respond with the role and user ID from the authenticated user
  res.json({
    role: req.user.role,
    id: req.user._id.toString(),
  });
});

// Login (with validation and single session)
router.post("/login", async (req, res) => {
  const { username, password } = req.body;
  console.log("Login attempt:", { username, password });
  if (
    !username ||
    username.length < 3 ||
    username.length > 20 ||
    !/^[a-zA-Z0-9]+$/.test(username)
  ) {
    return res
      .status(400)
      .json({ error: "Invalid username: 3-20 alphanumeric characters." });
  }
  const user = await User.findOne({ username });
  console.log("User found:", user ? user.username : null);
  if (!user || !(await user.comparePassword(password))) {
    return res.status(401).json({ error: "Invalid credentials" });
  }
  const token = jwt.sign(
    { id: user._id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );
  user.activeToken = token;
  await user.save();
  console.log("Login successful:", { username, token });
  res.json({
    token,
    role: user.role,
    id: user._id.toString(),
  }); // Include user ID in login response
});

// Create User (with validation)
router.post("/create-user", verifyToken, async (req, res) => {
  // Protected
  if (req.user.role !== "owner" && req.user.role !== "admin") {
    return res.status(403).json({ error: "Unauthorized" });
  }

  const { username, password, role } = req.body;

  // Username validation
  if (
    !username ||
    username.length < 3 ||
    username.length > 20 ||
    !/^[a-zA-Z0-9]+$/.test(username)
  ) {
    return res
      .status(400)
      .json({ error: "Invalid username: 3-20 alphanumeric characters." });
  }

  const newUser = new User({
    username,
    password,
    role,
    createdBy: req.user._id,
  });
  await newUser.save();
  res.json({ success: true });
});

// Logout (clear activeToken)
router.post("/logout", verifyToken, async (req, res) => {
  req.user.activeToken = null;
  await req.user.save();
  res.json({ success: true });
});

// Add verifyToken to other routes like /dial/*, /twilio/*
// Example: router.get('/reports', verifyToken, async (req, res) => { ... });

module.exports = { router, verifyToken }; // Export verifyToken for other routes
