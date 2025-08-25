const express = require("express");
const CallLog = require("../models/CallLog");
const User = require("../models/User");
const { verifyToken: auth } = require("../routes/auth"); // Add this line
const router = express.Router();

// Get reports with role-based filtering
router.get("/reports", async (req, res) => {
  try {
    const { role, _id: userId } = req.user;
    let query = {};
    let populateOptions = {
      path: "userId",
      select: "username role createdBy",
      populate: {
        path: "createdBy",
        select: "username role",
      },
    };

    switch (role) {
      case "owner":
        // Owner can see ALL reports from everyone
        query = {};
        console.log("Owner can see all reports");
        break;

      case "admin":
        // Admin can see their own reports and reports from agents they created
        const agentsCreatedByAdmin = await User.find({
          createdBy: userId,
          role: "agent",
        }).select("_id");

        const agentIds = agentsCreatedByAdmin.map((agent) => agent._id);
        query = {
          $or: [
            { userId: userId }, // Admin's own reports
            { userId: { $in: agentIds } }, // Reports from their agents
          ],
        };
        console.log("Admin query:", query);
        break;

      case "agent":
        // Agents can only see their own reports
        query = { userId: userId };
        console.log("Agent can only see own reports");
        break;

      default:
        return res.status(403).json({ error: "Invalid role" });
    }

    const reports = await CallLog.find(query)
      .populate(populateOptions)
      .sort({ startTime: -1 })
      .limit(1000); // Limit for performance

    // Add enhanced user info to response for frontend display
    const reportsWithUserInfo = reports.map((report) => ({
      ...report.toObject(),
      userName: report.userId?.username,
      userRole: report.userId?.role,
      userEmail: report.userId?.username, // Since you're using username
      createdByUser: report.userId?.createdBy?.username, // Who created this user
      createdByRole: report.userId?.createdBy?.role, // Role of who created this user
    }));

    res.json(reportsWithUserInfo);
  } catch (error) {
    console.error("Error fetching reports:", error);
    res.status(500).json({ error: "Failed to fetch reports" });
  }
});

// Get users based on role (for management)
router.get("/users", async (req, res) => {
  try {
    const { role, _id: userId } = req.user;
    let query = {};

    switch (role) {
      case "owner":
        // Owner can see ALL users (admins and agents)
        query = {};
        console.log("Owner can see all users");
        break;
      case "admin":
        // Admin can see only agents they created
        query = { createdBy: userId, role: "agent" };
        console.log("Admin can see their agents:", query);
        break;
      case "agent":
        // Agents can't see other users
        return res.status(403).json({ error: "Agents cannot view users" });
      default:
        return res.status(403).json({ error: "Invalid role" });
    }

    const users = await User.find(query)
      .select("username role createdAt createdBy")
      .populate("createdBy", "username role")
      .sort({ createdAt: -1 });

    // Add hierarchy info for owner view
    const usersWithHierarchy = users.map((user) => ({
      ...user.toObject(),
      hierarchyLevel:
        user.role === "admin"
          ? "Direct Report"
          : user.createdBy?.role === "admin"
          ? "Agent (via Admin)"
          : "Direct Agent",
      createdByInfo: user.createdBy
        ? {
            username: user.createdBy.username,
            role: user.createdBy.role,
          }
        : null,
    }));

    res.json(usersWithHierarchy);
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

// Get dashboard stats with proper hierarchy
router.get("/stats", async (req, res) => {
  try {
    const { role, _id: userId } = req.user;
    let query = {};
    let userQuery = {};

    // Apply role-based filtering for stats
    switch (role) {
      case "owner":
        // Owner sees stats for ALL users
        query = {};
        userQuery = {};
        break;
      case "admin":
        // Admin sees stats for themselves and their agents
        const agentsCreatedByAdmin = await User.find({
          createdBy: userId,
          role: "agent",
        }).select("_id");
        const agentIds = agentsCreatedByAdmin.map((agent) => agent._id);
        query = {
          $or: [{ userId: userId }, { userId: { $in: agentIds } }],
        };
        userQuery = { createdBy: userId, role: "agent" };
        break;
      case "agent":
        // Agent sees only their own stats
        query = { userId: userId };
        userQuery = { _id: userId };
        break;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [totalCallsToday, totalCalls, activeSessions, totalUsers] =
      await Promise.all([
        CallLog.countDocuments({ ...query, startTime: { $gte: today } }),
        CallLog.countDocuments(query),
        CallLog.countDocuments({
          ...query,
          status: { $in: ["connecting", "ringing", "on_call"] },
        }),
        User.countDocuments(userQuery),
      ]);

    // Get additional stats for owner
    let additionalStats = {};
    if (role === "owner") {
      const [totalAdmins, totalAgents, totalReports] = await Promise.all([
        User.countDocuments({ role: "admin" }),
        User.countDocuments({ role: "agent" }),
        CallLog.countDocuments({}),
      ]);

      additionalStats = {
        totalAdmins,
        totalAgents,
        totalReports,
        totalUsers: totalAdmins + totalAgents + 1, // +1 for owner
      };
    }

    res.json({
      totalCallsToday,
      totalCalls,
      activeSessions,
      totalUsers,
      userRole: role,
      ...additionalStats,
    });
  } catch (error) {
    console.error("Error fetching stats:", error);
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

// Delete user (enhanced with proper hierarchy checking)
router.delete("/users/:id", async (req, res) => {
  try {
    const { role, _id: userId } = req.user;
    const targetUserId = req.params.id;

    // Find the target user
    const targetUser = await User.findById(targetUserId).populate(
      "createdBy",
      "username role"
    );
    if (!targetUser) {
      return res.status(404).json({ error: "User not found" });
    }

    // Check permissions
    if (role === "owner") {
      // Owner can delete anyone except themselves
      if (targetUserId === userId.toString()) {
        return res.status(400).json({ error: "Cannot delete yourself" });
      }
    } else if (role === "admin") {
      // Admin can only delete agents they created
      if (
        targetUser.role !== "agent" ||
        targetUser.createdBy._id.toString() !== userId.toString()
      ) {
        return res
          .status(403)
          .json({ error: "You can only delete agents you created" });
      }
    } else {
      return res.status(403).json({ error: "Insufficient permissions" });
    }

    // If deleting an admin, also delete all agents they created
    let deletedCount = 0;
    if (targetUser.role === "admin") {
      const agentsToDelete = await User.find({ createdBy: targetUserId });

      // Delete call logs for all agents created by this admin
      for (const agent of agentsToDelete) {
        await CallLog.deleteMany({ userId: agent._id });
      }

      // Delete all agents created by this admin
      const agentDeleteResult = await User.deleteMany({
        createdBy: targetUserId,
      });
      deletedCount = agentDeleteResult.deletedCount;
    }

    // Delete the target user's call logs
    await CallLog.deleteMany({ userId: targetUserId });

    // Delete the target user
    await User.findByIdAndDelete(targetUserId);

    const message =
      deletedCount > 0
        ? `User ${targetUser.username} deleted successfully along with ${deletedCount} associated agents`
        : `User ${targetUser.username} deleted successfully`;

    res.json({ success: true, message, deletedAgents: deletedCount });
  } catch (error) {
    console.error("Error deleting user:", error);
    res.status(500).json({ error: "Failed to delete user" });
  }
});

// Export CSV reports (no changes needed - already works correctly)
router.get("/export-csv", async (req, res) => {
  try {
    const { role, _id: userId } = req.user;
    let query = {};

    // Apply same role-based filtering as reports
    switch (role) {
      case "owner":
        query = {};
        break;
      case "admin":
        const agentsCreatedByAdmin = await User.find({
          createdBy: userId,
          role: "agent",
        }).select("_id");
        const agentIds = agentsCreatedByAdmin.map((agent) => agent._id);
        query = {
          $or: [{ userId: userId }, { userId: { $in: agentIds } }],
        };
        break;
      case "agent":
        query = { userId: userId };
        break;
      default:
        return res.status(403).json({ error: "Invalid role" });
    }

    const reports = await CallLog.find(query)
      .populate("userId", "username role")
      .sort({ startTime: -1 });

    // Create CSV content
    const csvHeader =
      "Phone Number,Duration,Disposition,Start Time,End Time,Type,User,User Role,Notes\n";
    const csvRows = reports
      .map((report) => {
        const startTime = report.startTime
          ? new Date(report.startTime).toLocaleString()
          : "";
        const endTime = report.endTime
          ? new Date(report.endTime).toLocaleString()
          : "";
        const duration = report.duration || 0;
        const disposition = (report.disposition || "").replace(/,/g, ";");
        const notes = (report.notes || "")
          .replace(/,/g, ";")
          .replace(/\n/g, " ");

        return `"${
          report.phoneNumber
        }","${duration}","${disposition}","${startTime}","${endTime}","${
          report.type
        }","${report.userId?.username || "Unknown"}","${
          report.userId?.role || "Unknown"
        }","${notes}"`;
      })
      .join("\n");

    const csvContent = csvHeader + csvRows;

    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="reports_${
        new Date().toISOString().split("T")[0]
      }.csv"`
    );
    res.send(csvContent);
  } catch (error) {
    console.error("Error exporting CSV:", error);
    res.status(500).json({ error: "Failed to export CSV" });
  }
});

// Upload numbers file (owner only)
router.post("/upload-numbers", async (req, res) => {
  try {
    if (req.user.role !== "owner") {
      return res
        .status(403)
        .json({ error: "Only owners can upload number files" });
    }

    const { numbers, fileName } = req.body;

    if (!numbers || !Array.isArray(numbers)) {
      return res.status(400).json({ error: "Invalid numbers data" });
    }

    res.json({
      success: true,
      message: `Successfully uploaded ${numbers.length} numbers from ${fileName}`,
      count: numbers.length,
    });
  } catch (error) {
    console.error("Error uploading numbers:", error);
    res.status(500).json({ error: "Failed to upload numbers" });
  }
});

// Add the call log endpoint
router.post("/log", auth, async (req, res) => {
  try {
    const {
      userId,
      type,
      phoneNumber,
      auditAction,
      status,
      endedBy,
      disposition,
      notes,
      duration,
      licenseAgentDuration,
    } = req.body;

    const updateData = {
      userId,
      phoneNumber,
      type,
      auditAction,
    };

    // Set timestamps based on status
    if (status === "ringing") {
      updateData.ringTime = new Date();
    } else if (status === "on_call") {
      updateData.answerTime = new Date();
    } else if (status === "ended") {
      updateData.endTime = new Date();
    }

    // Add optional fields if present
    if (status) updateData.status = status;
    if (endedBy) updateData.endedBy = endedBy;
    if (disposition) updateData.disposition = disposition;
    if (notes) updateData.notes = notes;
    if (duration) updateData.duration = duration;
    if (licenseAgentDuration)
      updateData.licenseAgentDuration = licenseAgentDuration;

    const callLog = new CallLog(updateData);
    await callLog.save();

    res.json({
      success: true,
      callId: callLog._id,
      message: `Call ${auditAction} logged successfully`,
    });
  } catch (error) {
    console.error("Call log error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to log call",
    });
  }
});

// Add the disposition endpoint
router.post("/disposition", auth, async (req, res) => {
  try {
    const { callId, disposition, notes } = req.body;

    const callLog = await CallLog.findByIdAndUpdate(
      callId,
      {
        disposition,
        notes,
        auditAction: "Disposition Set",
      },
      { new: true }
    );

    if (!callLog) {
      return res.status(404).json({
        success: false,
        error: "Call log not found",
      });
    }

    res.json({
      success: true,
      message: "Disposition saved successfully",
    });
  } catch (error) {
    console.error("Disposition error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to save disposition",
    });
  }
});

module.exports = router;
