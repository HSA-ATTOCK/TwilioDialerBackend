const express = require("express");
const Organization = require("../models/Organization");
const User = require("../models/User");
const jwt = require("jsonwebtoken");
const { authMiddleware } = require("../middleware/auth");
const router = express.Router();

// Middleware to check if user is owner or system admin
const ownerOnly = (req, res, next) => {
  if (req.user.role !== "owner") {
    return res.status(403).json({ error: "Access denied. Owner only." });
  }
  next();
};

// Middleware to check if user is owner or admin
const ownerOrAdmin = (req, res, next) => {
  if (!["owner", "admin"].includes(req.user.role)) {
    return res
      .status(403)
      .json({ error: "Access denied. Owner or Admin only." });
  }
  next();
};

// GET ORGANIZATION DETAILS
router.get("/details", authMiddleware, async (req, res) => {
  try {
    const organization = await Organization.findById(
      req.user.organizationId
    ).populate("createdBy", "username email firstName lastName");

    if (!organization) {
      return res.status(404).json({ error: "Organization not found" });
    }

    res.json(organization);
  } catch (error) {
    console.error("Get organization error:", error);
    res.status(500).json({ error: error.message });
  }
});

// UPDATE ORGANIZATION SETTINGS (Owner only)
router.put("/settings", authMiddleware, ownerOnly, async (req, res) => {
  try {
    const { settings } = req.body;

    const organization = await Organization.findByIdAndUpdate(
      req.user.organizationId,
      {
        settings: {
          ...settings,
          // Ensure some limits are maintained
          maxUsers: Math.min(settings.maxUsers || 50, 500),
          maxAgents: Math.min(settings.maxAgents || 25, 250),
        },
      },
      { new: true }
    );

    if (!organization) {
      return res.status(404).json({ error: "Organization not found" });
    }

    res.json({
      message: "Organization settings updated successfully",
      settings: organization.settings,
    });
  } catch (error) {
    console.error("Update organization settings error:", error);
    res.status(500).json({ error: error.message });
  }
});

// GET ORGANIZATION STATISTICS (Owner/Admin only)
router.get("/statistics", authMiddleware, ownerOrAdmin, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;

    // Get user counts
    const totalUsers = await User.countDocuments({
      organizationId,
      isActive: true,
    });
    const adminCount = await User.countDocuments({
      organizationId,
      role: "admin",
      isActive: true,
    });
    const agentCount = await User.countDocuments({
      organizationId,
      role: "agent",
      isActive: true,
    });

    // Get call statistics for today
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const CallLog = require("../models/CallLog");
    const DialList = require("../models/DialList");

    const todayCalls = await CallLog.countDocuments({
      organizationId,
      startTime: { $gte: today, $lt: tomorrow },
    });

    const totalNumbers = await DialList.countDocuments({ organizationId });
    const pendingNumbers = await DialList.countDocuments({
      organizationId,
      dialingStatus: "pending",
    });

    res.json({
      users: {
        total: totalUsers,
        admins: adminCount,
        agents: agentCount,
      },
      calls: {
        today: todayCalls,
      },
      dialList: {
        total: totalNumbers,
        pending: pendingNumbers,
        completed: totalNumbers - pendingNumbers,
      },
    });
  } catch (error) {
    console.error("Get organization statistics error:", error);
    res.status(500).json({ error: error.message });
  }
});

// LIST ALL ORGANIZATIONS (System Admin only - for future use)
router.get("/list", async (req, res) => {
  try {
    // This would require system admin authentication
    // For now, just return error
    res.status(403).json({ error: "System admin access required" });
  } catch (error) {
    console.error("List organizations error:", error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
