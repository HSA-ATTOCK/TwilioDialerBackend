const express = require("express");
const Organization = require("../models/Organization");
const User = require("../models/User");
const jwt = require("jsonwebtoken");
const DeviceFingerprint = require("../utils/deviceFingerprint");
const { authMiddleware } = require("../middleware/auth");
const router = express.Router();

// Middleware to check if user is platform admin
const platformAdminOnly = (req, res, next) => {
  if (req.user.role !== "platformadmin") {
    return res
      .status(403)
      .json({ error: "Access denied. Platform Admin only." });
  }
  next();
};

// CHECK USERNAME AVAILABILITY FOR OWNER CREATION (Platform Admin)
router.post(
  "/check-username",
  authMiddleware,
  platformAdminOnly,
  async (req, res) => {
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
  }
);

// GET ALL ORGANIZATIONS (Platform Admin Dashboard)
router.get(
  "/organizations",
  authMiddleware,
  platformAdminOnly,
  async (req, res) => {
    try {
      const organizations = await Organization.find({})
        .populate("createdBy", "username")
        .sort({ createdAt: -1 });

      // Get platform statistics
      router.get(
        "/statistics",
        authMiddleware,
        platformAdminOnly,
        async (req, res) => {
          try {
            // Get organization statistics
            const totalOrganizations = await Organization.countDocuments();
            const activeOrganizations = await Organization.countDocuments({
              isActive: true,
            });

            // Get user statistics
            const totalUsers = await User.countDocuments();
            const usersByRole = await User.aggregate([
              { $group: { _id: "$role", count: { $sum: 1 } } },
            ]);

            const roleStats = {
              owner: 0,
              admin: 0,
              agent: 0,
              platformadmin: 0,
            };

            usersByRole.forEach((role) => {
              roleStats[role._id] = role.count;
            });

            // Get monthly growth statistics
            const currentDate = new Date();
            const lastMonth = new Date(
              currentDate.getFullYear(),
              currentDate.getMonth() - 1,
              1
            );

            const recentOrganizations = await Organization.countDocuments({
              createdAt: { $gte: lastMonth },
            });

            const recentUsers = await User.countDocuments({
              createdAt: { $gte: lastMonth },
            });

            const statistics = {
              organizations: {
                total: totalOrganizations,
                active: activeOrganizations,
                inactive: totalOrganizations - activeOrganizations,
                recentlyCreated: recentOrganizations,
              },
              users: {
                total: totalUsers,
                owners: roleStats.owner,
                admins: roleStats.admin,
                agents: roleStats.agent,
                platformAdmins: roleStats.platformadmin,
                recentlyCreated: recentUsers,
              },
            };

            res.json({
              success: true,
              statistics,
            });
          } catch (error) {
            console.error("Error fetching platform statistics:", error);
            res.status(500).json({
              success: false,
              error: "Failed to fetch platform statistics",
            });
          }
        }
      );

      // Get all organizations with user counts
      const orgData = await Promise.all(
        organizations.map(async (org) => {
          const userCounts = await User.aggregate([
            { $match: { organizationId: org._id } },
            { $group: { _id: "$role", count: { $sum: 1 } } },
          ]);

          const counts = { owner: 0, admin: 0, agent: 0 };
          userCounts.forEach((item) => {
            counts[item._id] = item.count;
          });

          return {
            _id: org._id,
            name: org.name,
            email: org.email,
            phone: org.phone,
            isActive: org.isActive,
            createdAt: org.createdAt,
            createdBy: org.createdBy,
            userCounts: counts,
            totalUsers: counts.owner + counts.admin + counts.agent,
            subscription: org.subscription,
          };
        })
      );

      res.json({
        success: true,
        organizations: orgData,
        total: organizations.length,
      });
    } catch (error) {
      console.error("Get organizations error:", error);
      res.status(500).json({ error: error.message });
    }
  }
);

// CREATE NEW ORGANIZATION (Step 1: Organization Details)
router.post(
  "/organizations",
  authMiddleware,
  platformAdminOnly,
  async (req, res) => {
    try {
      const { name, description, email, phone, address, settings } = req.body;

      // Validate required fields
      if (!name || !email || !phone) {
        return res.status(400).json({
          error: "Missing required fields: name, email, phone",
        });
      }

      // Check if organization already exists
      const existingOrg = await Organization.findOne({
        $or: [{ name }, { email }],
      });

      if (existingOrg) {
        return res.status(400).json({
          error: "Organization with this name or email already exists",
        });
      }

      // Create organization
      const organization = new Organization({
        name,
        description,
        email,
        phone,
        address: address || {},
        settings: {
          timezone: settings?.timezone || "UTC",
          dateFormat: settings?.dateFormat || "MM/DD/YYYY",
          currency: settings?.currency || "USD",
          maxUsers: settings?.maxUsers || 50,
          maxAgents: settings?.maxAgents || 25,
        },
        createdBy: req.user.id,
      });

      const savedOrganization = await organization.save();

      res.status(201).json({
        success: true,
        message: "Organization created successfully",
        organization: {
          id: savedOrganization._id,
          name: savedOrganization.name,
          email: savedOrganization.email,
        },
      });
    } catch (error) {
      console.error("Organization creation error:", error);
      res.status(500).json({ error: error.message });
    }
  }
);

// CREATE OWNER FOR ORGANIZATION (Step 2: Owner Creation)
router.post(
  "/organizations/:organizationId/owner",
  authMiddleware,
  platformAdminOnly,
  async (req, res) => {
    try {
      const { organizationId } = req.params;
      const { username, password, firstName, lastName, email, phone } =
        req.body;

      // Validate required fields
      if (!username || !password) {
        return res.status(400).json({
          error: "Missing required fields: username, password",
        });
      }

      // Check if organization exists
      const organization = await Organization.findById(organizationId);
      if (!organization) {
        return res.status(404).json({ error: "Organization not found" });
      }

      // Check if username already exists
      const existingUser = await User.findOne({ username });
      if (existingUser) {
        return res.status(400).json({ error: "Username already exists" });
      }

      // Check if organization already has an owner
      const existingOwner = await User.findOne({
        organizationId,
        role: "owner",
      });
      if (existingOwner) {
        return res.status(400).json({
          error: "Organization already has an owner",
        });
      }

      // Create owner user
      const owner = new User({
        username,
        password,
        role: "owner",
        organizationId,
        createdBy: req.user.id,
        firstName,
        lastName,
        email,
        phone,
        isActive: true,
        permissions: {
          canUploadNumbers: true,
          canManageUsers: true,
          canViewReports: true,
          canManageSettings: true,
        },
      });

      const savedOwner = await owner.save();

      res.status(201).json({
        success: true,
        message: "Owner created successfully",
        owner: {
          id: savedOwner._id,
          username: savedOwner.username,
          role: savedOwner.role,
          organizationId: savedOwner.organizationId,
        },
      });
    } catch (error) {
      console.error("Owner creation error:", error);
      res.status(500).json({ error: error.message });
    }
  }
);

// UPDATE ORGANIZATION
router.put(
  "/organizations/:organizationId",
  authMiddleware,
  platformAdminOnly,
  async (req, res) => {
    try {
      const { organizationId } = req.params;
      const updateData = req.body;

      // Don't allow updating createdBy
      delete updateData.createdBy;

      const organization = await Organization.findByIdAndUpdate(
        organizationId,
        updateData,
        { new: true, runValidators: true }
      );

      if (!organization) {
        return res.status(404).json({ error: "Organization not found" });
      }

      res.json({
        success: true,
        message: "Organization updated successfully",
        organization,
      });
    } catch (error) {
      console.error("Organization update error:", error);
      res.status(500).json({ error: error.message });
    }
  }
);

// DELETE ORGANIZATION
router.delete(
  "/organizations/:organizationId",
  authMiddleware,
  platformAdminOnly,
  async (req, res) => {
    try {
      const { organizationId } = req.params;

      // Check if organization exists
      const organization = await Organization.findById(organizationId);
      if (!organization) {
        return res.status(404).json({ error: "Organization not found" });
      }

      // Check if organization has users
      const userCount = await User.countDocuments({ organizationId });
      if (userCount > 0) {
        return res.status(400).json({
          error: `Cannot delete organization with ${userCount} users. Please remove all users first.`,
        });
      }

      // Delete organization
      await Organization.findByIdAndDelete(organizationId);

      res.json({
        success: true,
        message: "Organization deleted successfully",
      });
    } catch (error) {
      console.error("Organization deletion error:", error);
      res.status(500).json({ error: error.message });
    }
  }
);

// ACTIVATE/DEACTIVATE ORGANIZATION
router.patch(
  "/organizations/:organizationId/status",
  authMiddleware,
  platformAdminOnly,
  async (req, res) => {
    try {
      const { organizationId } = req.params;
      const { isActive } = req.body;

      // Update organization status
      const organization = await Organization.findByIdAndUpdate(
        organizationId,
        { isActive },
        { new: true }
      );

      if (!organization) {
        return res.status(404).json({ error: "Organization not found" });
      }

      // If deactivating organization, revoke access for all users in this organization
      if (!isActive) {
        // Clear active tokens and deactivate all users in this organization
        const updateResult = await User.updateMany(
          { organizationId: organizationId },
          {
            $unset: { activeToken: 1 }, // Remove active tokens to force re-login
            $set: { isActive: false }, // Deactivate all users
          }
        );

        console.log(
          `Organization ${organization.name} deactivated: ${updateResult.modifiedCount} users revoked access`
        );

        res.json({
          success: true,
          message: `Organization deactivated successfully. ${updateResult.modifiedCount} users have been revoked access and must re-login when organization is reactivated.`,
          organization,
          usersAffected: updateResult.modifiedCount,
        });
      } else {
        // If activating organization, reactivate all users in this organization
        const updateResult = await User.updateMany(
          { organizationId: organizationId },
          { $set: { isActive: true } } // Reactivate all users
        );

        console.log(
          `Organization ${organization.name} activated: ${updateResult.modifiedCount} users granted access`
        );

        res.json({
          success: true,
          message: `Organization activated successfully. ${updateResult.modifiedCount} users have been granted access.`,
          organization,
          usersAffected: updateResult.modifiedCount,
        });
      }
    } catch (error) {
      console.error("Organization status update error:", error);
      res.status(500).json({ error: error.message });
    }
  }
);

// GET ORGANIZATION DETAILS
router.get(
  "/organizations/:organizationId",
  authMiddleware,
  platformAdminOnly,
  async (req, res) => {
    try {
      const { organizationId } = req.params;

      const organization = await Organization.findById(organizationId).populate(
        "createdBy",
        "username"
      );

      if (!organization) {
        return res.status(404).json({ error: "Organization not found" });
      }

      // Get users in this organization
      const users = await User.find({ organizationId })
        .select("username role firstName lastName email createdAt isActive")
        .sort({ createdAt: -1 });

      res.json({
        success: true,
        organization,
        users,
        userCount: users.length,
      });
    } catch (error) {
      console.error("Get organization details error:", error);
      res.status(500).json({ error: error.message });
    }
  }
);

// PLATFORM ADMIN STATISTICS
router.get(
  "/statistics",
  authMiddleware,
  platformAdminOnly,
  async (req, res) => {
    try {
      const totalOrganizations = await Organization.countDocuments({});
      const activeOrganizations = await Organization.countDocuments({
        isActive: true,
      });
      const totalUsers = await User.countDocuments({
        role: { $ne: "platformadmin" },
      });

      // Get user counts by role
      const usersByRole = await User.aggregate([
        { $match: { role: { $ne: "platformadmin" } } },
        { $group: { _id: "$role", count: { $sum: 1 } } },
      ]);

      const roleCounts = { owner: 0, admin: 0, agent: 0 };
      usersByRole.forEach((item) => {
        roleCounts[item._id] = item.count;
      });

      res.json({
        success: true,
        statistics: {
          organizations: {
            total: totalOrganizations,
            active: activeOrganizations,
            inactive: totalOrganizations - activeOrganizations,
          },
          users: {
            total: totalUsers,
            owners: roleCounts.owner,
            admins: roleCounts.admin,
            agents: roleCounts.agent,
          },
        },
      });
    } catch (error) {
      console.error("Get platform statistics error:", error);
      res.status(500).json({ error: error.message });
    }
  }
);

// Get current device information
router.get(
  "/device-info",
  authMiddleware,
  platformAdminOnly,
  async (req, res) => {
    try {
      const user = await User.findById(req.user.id).select(
        "deviceInfo deviceFingerprint lastDeviceCheck"
      );
      const currentDevice = DeviceFingerprint.getDeviceDescription();
      const currentFingerprint = DeviceFingerprint.generateFingerprint();

      res.json({
        success: true,
        registeredDevice: user.deviceInfo,
        currentDevice,
        isDeviceMatched:
          user.deviceFingerprint === currentFingerprint.fingerprint,
        lastDeviceCheck: user.lastDeviceCheck,
        fingerprintExists: !!user.deviceFingerprint,
      });
    } catch (error) {
      console.error("Error getting device info:", error);
      res.status(500).json({
        success: false,
        error: "Failed to get device information",
      });
    }
  }
);

// Reset device fingerprint (for emergency access)
router.post(
  "/reset-device",
  authMiddleware,
  platformAdminOnly,
  async (req, res) => {
    try {
      const { currentPassword } = req.body;

      if (!currentPassword) {
        return res.status(400).json({
          success: false,
          error: "Current password is required to reset device registration",
        });
      }

      const user = await User.findById(req.user.id);

      // Verify current password
      if (!(await user.comparePassword(currentPassword))) {
        return res.status(401).json({
          success: false,
          error: "Invalid password",
        });
      }

      // Generate new device fingerprint
      const deviceInfo = DeviceFingerprint.generateFingerprint();

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

      res.json({
        success: true,
        message: "Device fingerprint reset successfully",
        deviceInfo: user.deviceInfo,
      });
    } catch (error) {
      console.error("Error resetting device:", error);
      res.status(500).json({
        success: false,
        error: "Failed to reset device registration",
      });
    }
  }
);

module.exports = router;
