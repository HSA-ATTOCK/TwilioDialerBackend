const jwt = require("jsonwebtoken");
const User = require("../models/User");

const authMiddleware = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];

    if (!token) {
      return res
        .status(401)
        .json({ error: "Access denied. No token provided." });
    }

    // Verify JWT token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Find user and verify token is still active
    const user = await User.findById(decoded.userId).populate(
      "organizationId",
      "name isActive"
    );

    if (!user) {
      return res.status(401).json({ error: "Invalid token. User not found." });
    }

    // Check if token matches active token (single session)
    if (user.activeToken !== token) {
      return res.status(401).json({
        error: "Token expired. User logged in elsewhere.",
      });
    }

    // Check if user is active
    if (!user.isActive) {
      return res.status(401).json({ error: "User account is deactivated." });
    }

    // Check if organization is active (skip for platform admin)
    if (user.role !== "platformadmin") {
      if (!user.organizationId || !user.organizationId.isActive) {
        return res.status(401).json({ error: "Organization is inactive." });
      }
    }

    // Add user info to request
    req.user = {
      id: user._id,
      userId: user._id,
      username: user.username,
      role: user.role,
      organizationId: user.organizationId ? user.organizationId._id : null,
      organizationName: user.organizationId ? user.organizationId.name : null,
      permissions: user.permissions,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
    };

    next();
  } catch (error) {
    console.error("Auth middleware error:", error);
    if (error.name === "JsonWebTokenError") {
      return res.status(401).json({ error: "Invalid token." });
    }
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Token expired." });
    }
    res.status(500).json({ error: "Authentication error." });
  }
};

// Role-based middleware
const requireRole = (roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Access denied. Required role: ${roles.join(" or ")}`,
      });
    }
    next();
  };
};

// Permission-based middleware
const requirePermission = (permission) => {
  return (req, res, next) => {
    if (req.user.role === "owner") {
      // Owners have all permissions
      return next();
    }

    if (!req.user.permissions || !req.user.permissions[permission]) {
      return res.status(403).json({
        error: `Access denied. Missing permission: ${permission}`,
      });
    }
    next();
  };
};

// Organization context middleware
const requireSameOrganization = async (req, res, next) => {
  try {
    const { userId, organizationId } = req.params;

    if (userId) {
      const user = await User.findById(userId);
      if (
        !user ||
        user.organizationId.toString() !== req.user.organizationId.toString()
      ) {
        return res.status(403).json({
          error: "Access denied. User not in your organization.",
        });
      }
    }

    if (
      organizationId &&
      organizationId !== req.user.organizationId.toString()
    ) {
      return res.status(403).json({
        error: "Access denied. Different organization.",
      });
    }

    next();
  } catch (error) {
    console.error("Organization context error:", error);
    res.status(500).json({ error: "Authorization error." });
  }
};

module.exports = {
  authMiddleware,
  requireRole,
  requirePermission,
  requireSameOrganization,
};
