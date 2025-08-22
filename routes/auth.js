const express = require("express");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const router = express.Router();

// Middleware to verify JWT and activeToken (add to protected routes)
const verifyToken = async (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1]; // Bearer token
  if (!token) return res.status(401).json({ error: "No token" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);
    if (!user || user.activeToken !== token) {
      return res
        .status(401)
        .json({ error: "Invalid or expired session. Login again." });
    }
    req.user = user;
    next();
  } catch (e) {
    res.status(401).json({ error: "Token error" });
  }
};

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
  res.json({ token, role: user.role }); // Ensure token is a string
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

  // Password validation handled in model pre-save

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

// router.post("/register-owner", async (req, res) => {
//   const { username, password } = req.body;
//   const user = new User({ username, password, role: "owner" });
//   await user.save();
//   res.json({ success: true });
// });

// Add verifyToken to other routes like /dial/*, /twilio/*
// Example: router.get('/reports', verifyToken, async (req, res) => { ... });

module.exports = { router, verifyToken }; // Export verifyToken for other routes
