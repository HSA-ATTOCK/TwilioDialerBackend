const express = require("express");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Organization = require("../models/Organization");
const DeviceFingerprint = require("../utils/deviceFingerprint");
const {
  authMiddleware,
  requireRole,
  requirePermission,
} = require("../middleware/auth");
const router = express.Router();

// CHECK USERNAME AVAILABILITY (Real-time validation)
router.post("/check-username", authMiddleware, async (req, res) => {
  try {
    const { username } = req.body;

    if (!username) {
      return res.status(400).json({ error: "Username is required" });
    }

    // Validate username format
    if (
      !username ||
      username.length < 3 ||
      username.length > 20 ||
      !/^[a-zA-Z0-9]+$/.test(username)
    ) {
      return res.status(400).json({
        available: false,
        error: "Invalid username: 3-20 alphanumeric characters required",
      });
    }

    // Check if username exists
    const existingUser = await User.findOne({ username });

    if (existingUser) {
      return res.json({
        available: false,
        error: "Username already exists",
      });
    }

    res.json({
      available: true,
      message: "Username is available",
    });
  } catch (error) {
    console.error("Username check error:", error);
    res.status(500).json({ error: "Failed to check username availability" });
  }
});

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
router.get("/verify", authMiddleware, (req, res) => {
  // Respond with the role and user ID from the authenticated user
  res.json({
    role: req.user.role,
    id: req.user.id,
    username: req.user.username,
    organizationId: req.user.organizationId,
    organizationName: req.user.organizationName,
    permissions: req.user.permissions,
    firstName: req.user.firstName,
    lastName: req.user.lastName,
  });
});

// Login (with validation and single session)
router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    console.log("Login attempt:", { username });

    if (
      !username ||
      username.length < 3 ||
      username.length > 20 ||
      !/^[a-zA-Z0-9]+$/.test(username)
    ) {
      return res.status(400).json({
        error: "Invalid username: 3-20 alphanumeric characters.",
      });
    }

    const user = await User.findOne({ username }).populate(
      "organizationId",
      "name isActive"
    );

    console.log("User found:", user ? user.username : null);

    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // Check if user is active
    if (!user.isActive) {
      return res.status(401).json({ error: "Account is deactivated" });
    }

    // Special device validation for platform admin
    if (user.role === "platformadmin") {
      const deviceInfo = DeviceFingerprint.generateFingerprint();

      // If no device fingerprint is stored, this is first login - register device
      if (!user.deviceFingerprint) {
        console.log("Registering platform admin device fingerprint");
        user.deviceFingerprint = deviceInfo.fingerprint;
        user.deviceInfo = {
          hostname: deviceInfo.components.hostname,
          platform: `${deviceInfo.components.platform} ${deviceInfo.components.arch}`,
          cpu: `${deviceInfo.components.cpuModel} (${deviceInfo.components.cpuCores} cores)`,
          memory: `${Math.round(
            deviceInfo.components.totalMemory / (1024 * 1024 * 1024)
          )} GB`,
          networkInterface: deviceInfo.components.macAddresses.join(", "),
          registeredAt: new Date(),
        };
        user.lastDeviceCheck = new Date();
        await user.save();
        console.log("Platform admin device registered successfully");
      } else {
        // Validate device fingerprint
        if (!DeviceFingerprint.validateFingerprint(user.deviceFingerprint)) {
          console.log("Platform admin device validation failed");
          return res.status(403).json({
            error:
              "Access denied: Platform admin can only be accessed from the registered device",
            code: "DEVICE_NOT_AUTHORIZED",
          });
        }

        // Update last device check
        user.lastDeviceCheck = new Date();
        await user.save();
        console.log("Platform admin device validation successful");
      }
    }

    // Check if organization is active (skip for platform admin)
    if (user.role !== "platformadmin") {
      if (!user.organizationId || !user.organizationId.isActive) {
        return res.status(401).json({ error: "Organization is inactive" });
      }
    }

    const token = jwt.sign(
      {
        userId: user._id,
        organizationId: user.organizationId ? user.organizationId._id : null,
        role: user.role,
      },
      process.env.JWT_SECRET,
      { expiresIn: "24h" }
    );

    user.activeToken = token;
    await user.save();

    console.log("Login successful:", { username, token });

    res.json({
      token,
      role: user.role,
      id: user._id.toString(),
      organizationId: user.organizationId
        ? user.organizationId._id.toString()
        : null,
      organizationName: user.organizationId ? user.organizationId.name : null,
      permissions: user.permissions,
      firstName: user.firstName,
      lastName: user.lastName,
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Login failed" });
  }
});

// Create User (with validation and organization context)
router.post(
  "/create-user",
  authMiddleware,
  requireRole(["owner", "admin"]),
  async (req, res) => {
    try {
      const {
        username,
        password,
        role,
        firstName,
        lastName,
        email,
        phone,
        permissions,
      } = req.body;

      // Username validation
      if (
        !username ||
        username.length < 3 ||
        username.length > 20 ||
        !/^[a-zA-Z0-9]+$/.test(username)
      ) {
        return res.status(400).json({
          error: "Invalid username: 3-20 alphanumeric characters.",
        });
      }

      // Role validation - owners can create anyone, admins can only create agents
      if (req.user.role === "admin" && role !== "agent") {
        return res.status(403).json({
          error: "Admins can only create agent users",
        });
      }

      // Check if user already exists
      const existingUser = await User.findOne({ username });
      if (existingUser) {
        return res.status(400).json({ error: "Username already exists" });
      }

      // Get organization to check user limits
      const organization = await Organization.findById(req.user.organizationId);
      const currentUserCount = await User.countDocuments({
        organizationId: req.user.organizationId,
        isActive: true,
      });

      if (currentUserCount >= organization.settings.maxUsers) {
        return res.status(400).json({
          error: `Maximum user limit reached (${organization.settings.maxUsers})`,
        });
      }

      // Set default permissions based on role
      let userPermissions = {
        canUploadNumbers: false,
        canManageUsers: false,
        canViewReports: false,
        canManageSettings: false,
      };

      if (role === "admin") {
        userPermissions = {
          canUploadNumbers: true,
          canManageUsers: true,
          canViewReports: true,
          canManageSettings: false,
        };
      } else if (role === "owner") {
        userPermissions = {
          canUploadNumbers: true,
          canManageUsers: true,
          canViewReports: true,
          canManageSettings: true,
        };
      }

      // Override with provided permissions if any
      if (permissions) {
        userPermissions = { ...userPermissions, ...permissions };
      }

      const newUser = new User({
        username,
        password,
        role,
        organizationId: req.user.organizationId,
        createdBy: req.user.id,
        firstName,
        lastName,
        email,
        phone,
        permissions: userPermissions,
      });

      await newUser.save();

      res.json({
        success: true,
        user: {
          id: newUser._id,
          username: newUser.username,
          role: newUser.role,
          firstName: newUser.firstName,
          lastName: newUser.lastName,
          email: newUser.email,
          permissions: newUser.permissions,
        },
      });
    } catch (error) {
      console.error("Create user error:", error);
      res.status(500).json({ error: error.message });
    }
  }
);

// Logout (clear activeToken)
router.post("/logout", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    user.activeToken = null;
    await user.save();
    res.json({ success: true });
  } catch (error) {
    console.error("Logout error:", error);
    res.status(500).json({ error: "Logout failed" });
  }
});

module.exports = { router, authMiddleware }; // Export authMiddleware for other routes
