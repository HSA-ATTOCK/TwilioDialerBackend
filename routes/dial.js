const express = require("express");
const CallLog = require("../models/CallLog");
const DialList = require("../models/DialList");
const User = require("../models/User");
const UserStatus = require("../models/UserStatus");
const { authMiddleware: auth } = require("../middleware/auth");
const router = express.Router();

// Get reports with role-based filtering - Updated to use DialList
router.get("/reports", async (req, res) => {
  try {
    const { role, id: userId, organizationId } = req.user;
    let query = { organizationId }; // Always filter by organization
    let populateOptions = [
      {
        path: "assignedTo",
        select: "username role createdBy",
        populate: {
          path: "createdBy",
          select: "username role",
        },
      },
      {
        path: "uploadedBy",
        select: "username role",
      },
    ];

    switch (role) {
      case "owner":
        // Owner can see ALL reports from their organization
        query = { organizationId, dialingStatus: "completed" };
        console.log("Owner can see all completed reports for organization");
        break;

      case "admin":
        // Admin can see reports from agents they created in their organization
        const agentsCreatedByAdmin = await User.find({
          createdBy: userId,
          organizationId,
          role: "agent",
        }).select("_id");

        const agentIds = agentsCreatedByAdmin.map((agent) => agent._id);
        agentIds.push(userId); // Include admin's own reports

        query = {
          organizationId,
          assignedTo: { $in: agentIds },
          dialingStatus: "completed",
        };
        console.log("Admin query:", query);
        break;

      case "agent":
        // Agents can only see their own reports in their organization
        query = {
          organizationId,
          assignedTo: userId,
          dialingStatus: "completed",
        };
        console.log("Agent can only see own completed reports");
        break;

      default:
        return res.status(403).json({ error: "Invalid role" });
    }

    const reports = await DialList.find(query)
      .populate(populateOptions)
      .sort({ completedAt: -1 })
      .limit(1000); // Limit for performance

    // Transform DialList data to match expected report format
    const reportsWithUserInfo = reports.map((report) => ({
      _id: report._id,
      phoneNumber: report.phoneNumber,
      disposition: report.disposition,
      comments: report.comments,
      notes: report.notes,
      createdAt: report.completedAt || report.createdAt,
      userName: report.assignedTo?.username,
      userRole: report.assignedTo?.role,
      userEmail: report.assignedTo?.username,
      uploadedByUser: report.uploadedBy?.username,
      attempts: report.attempts,
      lastDialedAt: report.lastDialedAt,
    }));

    res.json(reportsWithUserInfo);
  } catch (error) {
    console.error("Error fetching reports:", error);
    res.status(500).json({ error: "Failed to fetch reports" });
  }
});

// Get call logs with duration
router.get("/call-logs", async (req, res) => {
  try {
    const { role, id: userId, organizationId } = req.user;
    let query = { organizationId }; // Always filter by organization

    switch (role) {
      case "owner":
        // Owner can see ALL call logs from their organization
        query = { organizationId };
        break;
      case "admin":
        // Admin can see call logs from agents they created in their organization
        const adminAgents = await User.find({
          createdBy: userId,
          organizationId,
          role: "agent",
        });
        const agentIds = adminAgents.map((agent) => agent._id);
        agentIds.push(userId); // Include admin's own call logs
        query = { organizationId, userId: { $in: agentIds } };
        break;
      case "agent":
        // Agents can only see their own call logs in their organization
        query = { organizationId, userId };
        break;
      default:
        return res.status(403).json({ error: "Invalid role" });
    }

    const callLogs = await CallLog.find(query)
      .populate("userId", "username role")
      .sort({ startTime: -1 })
      .limit(100); // Limit to recent 100 calls

    const callLogsWithUserInfo = callLogs.map((log) => ({
      _id: log._id,
      phoneNumber: log.phoneNumber,
      duration: log.duration || 0,
      disposition: log.disposition,
      startTime: log.startTime,
      endTime: log.endTime,
      type: log.type,
      notes: log.notes,
      username: log.userId?.username || "Unknown",
      userRole: log.userId?.role || "Unknown",
      createdAt: log.createdAt || log.startTime,
    }));

    res.json(callLogsWithUserInfo);
  } catch (error) {
    console.error("Error fetching call logs:", error);
    res.status(500).json({ error: "Failed to fetch call logs" });
  }
});

// Get users based on role (for management) - organization-specific
router.get("/users", async (req, res) => {
  try {
    const { role, id: userId, organizationId } = req.user;
    let query = { organizationId }; // Always filter by organization

    switch (role) {
      case "owner":
        // Owner can see ALL users in their organization (admins and agents)
        query = { organizationId };
        console.log("Owner can see all users in organization:", organizationId);
        break;
      case "admin":
        // Admin can see only agents they created within their organization
        query = { createdBy: userId, role: "agent", organizationId };
        console.log("Admin can see their agents in organization:", query);
        break;
      case "agent":
        // Agents can't see other users
        return res.status(403).json({ error: "Agents cannot view users" });
      default:
        return res.status(403).json({ error: "Invalid role" });
    }

    const users = await User.find(query)
      .select("username role createdAt createdBy isActive")
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
    const { role, id: userId, organizationId } = req.user;
    let query = { organizationId }; // Filter by organization
    let userQuery = { organizationId }; // Filter by organization

    // Apply role-based filtering for stats within organization
    switch (role) {
      case "owner":
        // Owner sees stats for ALL users in their organization
        query = { organizationId };
        userQuery = { organizationId };
        break;
      case "admin":
        // Admin sees stats for themselves and their agents in their organization
        const agentsCreatedByAdmin = await User.find({
          createdBy: userId,
          role: "agent",
          organizationId,
        }).select("_id");
        const agentIds = agentsCreatedByAdmin.map((agent) => agent._id);
        query = {
          organizationId,
          $or: [{ userId: userId }, { userId: { $in: agentIds } }],
        };
        userQuery = { createdBy: userId, role: "agent", organizationId };
        break;
      case "agent":
        // Agent sees only their own stats
        query = { userId: userId, organizationId };
        userQuery = { _id: userId, organizationId };
        break;
    }

    // Pakistani time zone offset (UTC+5)
    const now = new Date();
    const pakistaniTime = new Date(now.getTime() + 5 * 60 * 60 * 1000);

    // Day starts at 6:00 PM and ends at 4:00 AM next day
    let dayStart, dayEnd;

    if (pakistaniTime.getHours() >= 18) {
      // If it's after 6 PM, day starts today at 6 PM
      dayStart = new Date(pakistaniTime);
      dayStart.setHours(18, 0, 0, 0);

      dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);
      dayEnd.setHours(4, 0, 0, 0);
    } else if (pakistaniTime.getHours() < 4) {
      // If it's before 4 AM, day started yesterday at 6 PM
      dayStart = new Date(pakistaniTime);
      dayStart.setDate(dayStart.getDate() - 1);
      dayStart.setHours(18, 0, 0, 0);

      dayEnd = new Date(pakistaniTime);
      dayEnd.setHours(4, 0, 0, 0);
    } else {
      // If it's between 4 AM and 6 PM, no active "day" - use regular day
      dayStart = new Date(pakistaniTime);
      dayStart.setHours(0, 0, 0, 0);
      dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);
    }

    // Convert back to UTC for database query
    const utcDayStart = new Date(dayStart.getTime() - 5 * 60 * 60 * 1000);
    const utcDayEnd = new Date(dayEnd.getTime() - 5 * 60 * 60 * 1000);

    const [totalCallsToday, totalCalls, activeSessions, totalUsers] =
      await Promise.all([
        CallLog.countDocuments({
          ...query,
          startTime: { $gte: utcDayStart, $lt: utcDayEnd },
        }),
        CallLog.countDocuments(query),
        CallLog.countDocuments({
          ...query,
          status: { $in: ["connecting", "ringing", "on_call"] },
        }),
        User.countDocuments(userQuery),
      ]);

    // Get additional stats for owner (organization-specific)
    let additionalStats = {};
    if (role === "owner") {
      const [totalAdmins, totalAgents, totalReports] = await Promise.all([
        User.countDocuments({ role: "admin", organizationId }),
        User.countDocuments({ role: "agent", organizationId }),
        CallLog.countDocuments({ organizationId }),
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

// Delete user (enhanced with proper hierarchy checking) - organization-specific
router.delete("/users/:id", async (req, res) => {
  try {
    const { role, id: userId, organizationId } = req.user;
    const targetUserId = req.params.id;

    // Find the target user within the same organization
    const targetUser = await User.findOne({
      _id: targetUserId,
      organizationId,
    }).populate("createdBy", "username role");

    if (!targetUser) {
      return res
        .status(404)
        .json({ error: "User not found in your organization" });
    }

    // Check permissions
    if (role === "owner") {
      // Owner can delete anyone in their organization except themselves
      if (targetUserId === userId.toString()) {
        return res.status(400).json({ error: "Cannot delete yourself" });
      }
    } else if (role === "admin") {
      // Admin can only delete agents they created within their organization
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

    // If deleting an admin, also delete all agents they created within the organization
    let deletedCount = 0;
    if (targetUser.role === "admin") {
      const agentsToDelete = await User.find({
        createdBy: targetUserId,
        organizationId,
      });

      // Delete call logs for all agents created by this admin
      for (const agent of agentsToDelete) {
        await CallLog.deleteMany({ userId: agent._id, organizationId });
      }

      // Delete all agents created by this admin within the organization
      const agentDeleteResult = await User.deleteMany({
        createdBy: targetUserId,
        organizationId,
      });
      deletedCount = agentDeleteResult.deletedCount;
    }

    // Delete the target user's call logs within the organization
    await CallLog.deleteMany({ userId: targetUserId, organizationId });

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

// Toggle user activation status (activate/deactivate) - organization-specific
router.patch("/users/:id/toggle-status", auth, async (req, res) => {
  try {
    const { role, id: userId, organizationId } = req.user;
    const targetUserId = req.params.id;

    // Find the target user within the same organization
    const targetUser = await User.findOne({
      _id: targetUserId,
      organizationId,
    }).populate("createdBy", "username role");

    if (!targetUser) {
      return res
        .status(404)
        .json({ error: "User not found in your organization" });
    }

    // Check permissions
    if (role === "owner") {
      // Owner can toggle status for anyone in their organization except themselves
      if (targetUserId === userId.toString()) {
        return res.status(400).json({ error: "Cannot change your own status" });
      }
    } else if (role === "admin") {
      // Admin can only toggle status for agents they created within their organization
      if (
        targetUser.role !== "agent" ||
        !targetUser.createdBy ||
        targetUser.createdBy._id.toString() !== userId.toString()
      ) {
        return res
          .status(403)
          .json({ error: "You can only manage agents you created" });
      }
    } else {
      return res.status(403).json({ error: "Insufficient permissions" });
    }

    // Toggle the activation status
    targetUser.isActive = !targetUser.isActive;
    await targetUser.save();

    // If deactivating, also clear any active tokens to force logout
    if (!targetUser.isActive) {
      targetUser.activeToken = null;
      await targetUser.save();
    }

    const statusText = targetUser.isActive ? "activated" : "deactivated";
    const message = `User ${targetUser.username} has been ${statusText} successfully`;

    res.json({
      success: true,
      message,
      user: {
        id: targetUser._id,
        username: targetUser.username,
        role: targetUser.role,
        isActive: targetUser.isActive,
      },
    });
  } catch (error) {
    console.error("Error toggling user status:", error);
    res.status(500).json({ error: "Failed to toggle user status" });
  }
});

// Export CSV reports (no changes needed - already works correctly)
router.get("/export-csv", async (req, res) => {
  try {
    const { role, id: userId, organizationId } = req.user;
    let query = { organizationId }; // Filter by organization

    // Apply same role-based filtering as reports within organization
    switch (role) {
      case "owner":
        query = { organizationId };
        break;
      case "admin":
        const agentsCreatedByAdmin = await User.find({
          createdBy: userId,
          role: "agent",
          organizationId,
        }).select("_id");
        const agentIds = agentsCreatedByAdmin.map((agent) => agent._id);
        query = {
          organizationId,
          $or: [{ userId: userId }, { userId: { $in: agentIds } }],
        };
        break;
      case "agent":
        query = { userId: userId, organizationId };
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

// Upload numbers file (owner/admin can upload and assign to agents)
router.post("/upload-numbers", auth, async (req, res) => {
  try {
    const { role, id: userId } = req.user;

    // Only owners and admins can upload numbers
    if (role === "agent") {
      return res
        .status(403)
        .json({ error: "Only owners and admins can upload number files" });
    }

    const { numbers, fileName, assignToUserId } = req.body;

    if (!numbers || !Array.isArray(numbers)) {
      return res.status(400).json({ error: "Invalid numbers data" });
    }

    if (!assignToUserId) {
      return res
        .status(400)
        .json({ error: "Please specify which user to assign numbers to" });
    }

    // Verify the user exists and is accessible
    const assignToUser = await User.findById(assignToUserId);
    if (!assignToUser) {
      return res
        .status(404)
        .json({ error: "User to assign numbers to not found" });
    }

    // Check permissions for assignment
    if (
      role === "admin" &&
      assignToUser.createdBy.toString() !== userId.toString() &&
      assignToUser._id.toString() !== userId.toString()
    ) {
      return res.status(403).json({
        error: "You can only assign numbers to agents you created or yourself",
      });
    }

    const results = {
      uploaded: 0,
      duplicates: 0,
      errors: [],
    };

    for (const number of numbers) {
      try {
        // Check if number already exists in the same organization
        const existingNumber = await DialList.findOne({
          phoneNumber: number,
          organizationId: req.user.organizationId, // FIXED: Add organizationId filter
        });

        if (existingNumber) {
          // Reset calling status while preserving disposition and comments
          await DialList.updateOne(
            {
              phoneNumber: number,
              organizationId: req.user.organizationId, // FIXED: Add organizationId filter
            },
            {
              $set: {
                dialingStatus: "pending",
                attempts: 0,
                currentlyDialingBy: null,
                assignedTo: assignToUserId,
                uploadedBy: userId,
              },
              $unset: {
                lastDialedAt: "",
                lastDialedBy: "",
              },
            }
          );
          results.duplicates++;
          continue;
        }

        // Create new dial list entry
        const dialListEntry = new DialList({
          phoneNumber: number,
          organizationId: req.user.organizationId, // FIXED: Add organizationId
          uploadedBy: userId,
          assignedTo: assignToUserId,
          dialingStatus: "pending",
        });

        await dialListEntry.save();
        results.uploaded++;
      } catch (error) {
        results.errors.push(`Error with number ${number}: ${error.message}`);
      }
    }

    res.json({
      success: true,
      message: `Successfully uploaded ${results.uploaded} new numbers, ${results.duplicates} existing numbers reset for re-dialing`,
      results,
    });
  } catch (error) {
    console.error("Error uploading numbers:", error);
    res.status(500).json({ error: "Failed to upload numbers" });
  }
});

// Get available agents for number assignment - organization-specific
router.get("/available-agents", auth, async (req, res) => {
  try {
    const { role, _id: userId, organizationId } = req.user;
    let query = { organizationId }; // Always filter by organization

    if (role === "owner") {
      // Owner can see all agents and admins in their organization
      query = {
        organizationId,
        role: { $in: ["admin", "agent"] },
      };
    } else if (role === "admin") {
      // Admin can see themselves and agents they created within their organization
      query = {
        organizationId,
        $or: [
          { _id: userId }, // Admin themselves
          { createdBy: userId, role: "agent" }, // Agents they created
        ],
      };
    } else {
      return res.status(403).json({ error: "Insufficient permissions" });
    }

    const users = await User.find(query).select("_id username role createdBy");
    res.json(users);
  } catch (error) {
    console.error("Error fetching available agents:", error);
    res.status(500).json({ error: "Failed to fetch available agents" });
  }
});

// Get numbers assigned to the current user for dialing
router.get("/my-numbers", auth, async (req, res) => {
  try {
    const userId = req.user.id; // FIXED: Use req.user.id instead of destructuring _id

    console.log("=== MY NUMBERS DEBUG ===");
    console.log("User ID:", userId);
    console.log("Organization ID:", req.user.organizationId);

    // First check all numbers assigned to this user regardless of organization
    const allUserNumbers = await DialList.find({ assignedTo: userId });
    console.log(
      "Total numbers assigned to user (any org):",
      allUserNumbers.length
    );

    if (allUserNumbers.length > 0) {
      console.log(
        "Sample user numbers:",
        allUserNumbers.slice(0, 3).map((n) => ({
          phoneNumber: n.phoneNumber,
          organizationId: n.organizationId,
          dialingStatus: n.dialingStatus,
          hasOrgId: !!n.organizationId,
        }))
      );
    }

    const numbers = await DialList.find({
      assignedTo: userId,
      organizationId: req.user.organizationId, // FIXED: Add organizationId filter
      dialingStatus: { $in: ["pending", "failed", "no_answer", "busy"] }, // Only get numbers that can be dialed
    })
      .sort({ priority: -1, createdAt: 1 }) // Higher priority first, then oldest first
      .limit(1000); // Limit for performance

    console.log("Numbers with org filter:", numbers.length);
    console.log("========================");

    res.json(numbers);
  } catch (error) {
    console.error("Error fetching user numbers:", error);
    res.status(500).json({ error: "Failed to fetch numbers" });
  }
});

// Get next number to dial (with locking mechanism)
router.post("/get-next-number", auth, async (req, res) => {
  try {
    const userId = req.user.id; // FIXED: Use req.user.id instead of destructuring _id

    console.log("=== GET NEXT NUMBER DEBUG ===");
    console.log("User ID:", userId);
    console.log("Organization ID:", req.user.organizationId);

    // First, let's see what numbers are available for this user
    const availableNumbers = await DialList.find({
      assignedTo: userId,
      organizationId: req.user.organizationId,
      dialingStatus: { $in: ["pending", "failed", "no_answer", "busy"] },
      currentlyDialingBy: null,
    }).limit(5);

    console.log("Available numbers for user:", availableNumbers.length);
    console.log(
      "First few available numbers:",
      availableNumbers.map((n) => ({
        phoneNumber: n.phoneNumber,
        dialingStatus: n.dialingStatus,
        attempts: n.attempts,
        priority: n.priority,
      }))
    );

    // Find the next available number - prioritize never-attempted, then retry failed ones
    const nextNumber = await DialList.findOneAndUpdate(
      {
        assignedTo: userId,
        organizationId: req.user.organizationId,
        dialingStatus: { $in: ["pending", "failed", "no_answer", "busy"] }, // FIXED: Allow retries
        currentlyDialingBy: null, // Not currently being dialed by someone else
        attempts: { $lt: 3 }, // FIXED: Allow up to 3 attempts instead of only 0
      },
      {
        dialingStatus: "dialing",
        currentlyDialingBy: userId,
        lastDialedAt: new Date(),
        $inc: { attempts: 1 },
      },
      {
        new: true,
        sort: { attempts: 1, priority: -1, createdAt: 1 }, // FIXED: Never-attempted first, then priority, then oldest
      }
    );

    console.log(
      "Next number found:",
      nextNumber
        ? {
            phoneNumber: nextNumber.phoneNumber,
            dialingStatus: nextNumber.dialingStatus,
            attempts: nextNumber.attempts,
            priority: nextNumber.priority,
          }
        : null
    );
    console.log("=============================");

    if (!nextNumber) {
      console.log("No more numbers available for user:", userId);
      return res.json({
        success: false,
        message: "No more numbers available to dial",
        hasMore: false,
      });
    }

    console.log(
      "Returning number:",
      nextNumber.phoneNumber,
      "to user:",
      userId
    );

    res.json({
      success: true,
      number: nextNumber,
      hasMore: true,
    });
  } catch (error) {
    console.error("Error getting next number:", error);
    res.status(500).json({ error: "Failed to get next number" });
  }
});

// Update number status after call completion
router.post("/update-number-status", auth, async (req, res) => {
  try {
    const userId = req.user.id; // FIXED: Use req.user.id instead of destructuring _id
    const { numberId, status, disposition, notes, comments } = req.body;

    if (!numberId || !status) {
      return res
        .status(400)
        .json({ error: "Number ID and status are required" });
    }

    const updateData = {
      dialingStatus: "completed", // Always mark as completed regardless of disposition
      currentlyDialingBy: null, // Release the lock
      completedAt: new Date(),
    };

    if (disposition) {
      updateData.disposition = disposition;
    }

    if (notes) {
      updateData.notes = notes;
    }

    if (comments) {
      updateData.comments = comments;
    }

    const updatedNumber = await DialList.findOneAndUpdate(
      {
        _id: numberId,
        organizationId: req.user.organizationId, // FIXED: Add organizationId filter
        currentlyDialingBy: userId, // Ensure only the user who locked it can update
      },
      updateData,
      { new: true }
    );

    if (!updatedNumber) {
      return res
        .status(404)
        .json({ error: "Number not found or not locked by you" });
    }

    res.json({
      success: true,
      message: "Number status updated successfully",
      number: updatedNumber,
    });
  } catch (error) {
    console.error("Error updating number status:", error);
    res.status(500).json({ error: "Failed to update number status" });
  }
});

// Release number lock (in case of errors or cancellation)
router.post("/release-number-lock", auth, async (req, res) => {
  try {
    const userId = req.user.id; // FIXED: Use req.user.id instead of destructuring _id
    const { numberId } = req.body;

    if (!numberId) {
      return res.status(400).json({ error: "Number ID is required" });
    }

    const updatedNumber = await DialList.findOneAndUpdate(
      {
        _id: numberId,
        organizationId: req.user.organizationId, // FIXED: Add organizationId filter
        currentlyDialingBy: userId,
      },
      {
        dialingStatus: "pending", // Reset to pending if it was in dialing state
        currentlyDialingBy: null,
      },
      { new: true }
    );

    if (!updatedNumber) {
      return res
        .status(404)
        .json({ error: "Number not found or not locked by you" });
    }

    res.json({
      success: true,
      message: "Number lock released successfully",
    });
  } catch (error) {
    console.error("Error releasing number lock:", error);
    res.status(500).json({ error: "Failed to release number lock" });
  }
});

// Get dialing statistics for a user
router.get("/dialing-stats", auth, async (req, res) => {
  try {
    const userId = req.user.id; // FIXED: Use req.user.id instead of destructuring _id

    console.log("=== DIALING STATS DEBUG ===");
    console.log("User ID:", userId);
    console.log("Organization ID:", req.user.organizationId);

    // Check all numbers for this user regardless of organization
    const allUserStats = await DialList.aggregate([
      { $match: { assignedTo: userId } },
      { $group: { _id: "$dialingStatus", count: { $sum: 1 } } },
    ]);
    console.log("All user numbers stats (any org):", allUserStats);

    const stats = await DialList.aggregate([
      {
        $match: {
          assignedTo: userId,
          organizationId: req.user.organizationId, // FIXED: Add organizationId filter
        },
      },
      {
        $group: {
          _id: "$dialingStatus",
          count: { $sum: 1 },
        },
      },
    ]);

    console.log("Org-filtered stats:", stats);
    console.log("===========================");

    const formattedStats = {
      pending: 0,
      dialing: 0,
      completed: 0,
      failed: 0,
      busy: 0,
      no_answer: 0,
    };

    stats.forEach((stat) => {
      formattedStats[stat._id] = stat.count;
    });

    res.json(formattedStats);
  } catch (error) {
    console.error("Error fetching dialing stats:", error);
    res.status(500).json({ error: "Failed to fetch dialing stats" });
  }
});

// Add the call log endpoint
router.post("/log", auth, async (req, res) => {
  try {
    const {
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

    // Use the authenticated user ID from the token, not from request body
    const userId = req.user.id;

    console.log("=== CALL LOG REQUEST ===");
    console.log("Action:", auditAction);
    console.log("Phone:", phoneNumber);
    console.log("Duration:", duration);
    console.log("User ID from token:", userId);
    console.log("Full body:", req.body);
    console.log("========================");

    if (auditAction === "start") {
      // Create new call log for call start
      const updateData = {
        userId,
        organizationId: req.user.organizationId,
        phoneNumber,
        type,
        auditAction,
        startTime: new Date(),
        status: status || "connecting",
      };

      const callLog = new CallLog(updateData);
      await callLog.save();

      console.log("Call log created for start:", callLog._id);

      // Update user's totalCallsToday count
      try {
        // Pakistani time zone offset (UTC+5)
        const now = new Date();
        const pakistaniTime = new Date(now.getTime() + 5 * 60 * 60 * 1000);

        // Check if this call is within current "day" (6 PM to 4 AM)
        let isCurrentDay = false;

        if (pakistaniTime.getHours() >= 18) {
          // After 6 PM - current day
          isCurrentDay = true;
        } else if (pakistaniTime.getHours() < 4) {
          // Before 4 AM - current day (started yesterday at 6 PM)
          isCurrentDay = true;
        }

        if (isCurrentDay) {
          await UserStatus.findOneAndUpdate(
            { userId, organizationId: req.user.organizationId },
            {
              $inc: { totalCallsToday: 1 },
              $setOnInsert: { organizationId: req.user.organizationId },
            },
            { upsert: true, new: true }
          );
          console.log("Incremented totalCallsToday for user:", userId);
        }
      } catch (error) {
        console.error("Error updating totalCallsToday:", error);
        // Don't fail the request if this update fails
      }

      res.json({
        success: true,
        callId: callLog._id,
        message: `Call ${auditAction} logged successfully`,
      });
    } else if (auditAction === "end") {
      // Update existing call log for call end
      try {
        // Find the most recent call log for this user and phone number that doesn't have an end time
        const existingCallLog = await CallLog.findOne({
          userId,
          phoneNumber,
          endTime: { $exists: false },
        }).sort({ startTime: -1 });

        console.log(
          "Found existing call log for update:",
          existingCallLog?._id
        );

        if (existingCallLog) {
          // Update the existing call log with end information
          const updateData = {
            endTime: new Date(),
            auditAction: "end",
            status: "ended",
          };

          // Add optional fields if present
          if (endedBy) updateData.endedBy = endedBy;
          if (disposition) updateData.disposition = disposition;
          if (notes) updateData.notes = notes;
          if (duration) updateData.duration = duration;
          if (licenseAgentDuration)
            updateData.licenseAgentDuration = licenseAgentDuration;

          console.log("Updating call log with data:", updateData);

          const updatedLog = await CallLog.findByIdAndUpdate(
            existingCallLog._id,
            updateData,
            { new: true }
          );

          console.log("Call log updated:", updatedLog);

          res.json({
            success: true,
            callId: existingCallLog._id,
            message: `Call ${auditAction} logged successfully`,
          });
        } else {
          console.log("No existing call log found, creating new one");
          // If no existing call log found, create a new one (fallback)
          const updateData = {
            userId,
            organizationId: req.user.organizationId, // FIXED: Add organizationId
            phoneNumber,
            type,
            auditAction,
            endTime: new Date(),
            status: "ended",
          };

          if (endedBy) updateData.endedBy = endedBy;
          if (disposition) updateData.disposition = disposition;
          if (notes) updateData.notes = notes;
          if (duration) updateData.duration = duration;
          if (licenseAgentDuration)
            updateData.licenseAgentDuration = licenseAgentDuration;

          const callLog = new CallLog(updateData);
          await callLog.save();

          console.log("New call log created for end:", callLog);

          res.json({
            success: true,
            callId: callLog._id,
            message: `Call ${auditAction} logged successfully`,
          });
        }
      } catch (updateError) {
        console.error("Error updating call log:", updateError);
        // Fallback to creating new log
        const updateData = {
          userId,
          organizationId: req.user.organizationId, // FIXED: Add organizationId
          phoneNumber,
          type,
          auditAction,
          endTime: new Date(),
          status: "ended",
        };

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
      }
    } else {
      // For other actions (ringing, connected, etc.), update existing or create new
      const updateData = {
        userId,
        organizationId: req.user.organizationId, // FIXED: Add organizationId
        phoneNumber,
        type,
        auditAction,
      };

      // Set timestamps based on status
      if (status === "ringing") {
        updateData.ringTime = new Date();
      } else if (status === "on_call") {
        updateData.answerTime = new Date();
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
    }
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

    console.log("=== DISPOSITION REQUEST ===");
    console.log("CallId:", callId);
    console.log("Disposition:", disposition);
    console.log("Notes:", notes);
    console.log("User ID:", req.user.id);
    console.log("Full body:", req.body);
    console.log("===========================");

    if (!callId) {
      console.log("ERROR: No callId provided");
      return res.status(400).json({
        success: false,
        error: "Call ID is required",
      });
    }

    // First, update the call log
    const callLog = await CallLog.findByIdAndUpdate(
      callId,
      {
        disposition,
        notes,
        auditAction: "Disposition Set",
      },
      { new: true }
    );

    console.log("CallLog update result:", callLog);

    if (!callLog) {
      console.log("ERROR: Call log not found for ID:", callId);
      return res.status(404).json({
        success: false,
        error: "Call log not found",
      });
    }

    // Now update the dial list entry for this phone number
    const phoneNumber = callLog.phoneNumber;
    console.log("Updating dial list for phone number:", phoneNumber);
    console.log("Looking for dial list entry with:");
    console.log("- phoneNumber:", phoneNumber);
    console.log("- assignedTo:", req.user.id);
    console.log("- organizationId:", req.user.organizationId);

    // First, let's see what dial list entries exist for this phone number
    const allEntriesForPhone = await DialList.find({
      phoneNumber: phoneNumber,
    });
    console.log("All dial list entries for this phone:", allEntriesForPhone);

    const dialListUpdate = await DialList.findOneAndUpdate(
      {
        phoneNumber: phoneNumber,
        assignedTo: req.user.id, // Only update if assigned to current user
        organizationId: req.user.organizationId, // FIXED: Add organizationId filter
      },
      {
        disposition: disposition,
        notes: notes,
        dialingStatus: "completed", // Mark as completed
        completedAt: new Date(),
        currentlyDialingBy: null, // Clear the currently dialing flag
      },
      { new: true }
    );

    console.log("DialList update result:", dialListUpdate);

    if (dialListUpdate) {
      console.log("Successfully updated dial list for phone:", phoneNumber);
    } else {
      console.log(
        "Warning: Could not find dial list entry for phone:",
        phoneNumber
      );
    }

    console.log("Disposition saved successfully for call:", callId);
    res.json({
      success: true,
      message: "Disposition saved successfully",
      updatedCallLog: !!callLog,
      updatedDialList: !!dialListUpdate,
    });
  } catch (error) {
    console.error("Disposition error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to save disposition",
    });
  }
});

// ================== USER STATUS ROUTES ==================

// Update user login status
router.post("/user-status/login", auth, async (req, res) => {
  try {
    const { id: userId, organizationId } = req.user;

    await UserStatus.findOneAndUpdate(
      { userId, organizationId },
      {
        isLoggedIn: true,
        lastLoginTime: new Date(),
        deviceStatus: "ready",
        lastActivity: new Date(),
        $setOnInsert: { organizationId },
      },
      { upsert: true, new: true }
    );

    res.json({ success: true, message: "Login status updated" });
  } catch (error) {
    console.error("Error updating login status:", error);
    res.status(500).json({ error: "Failed to update login status" });
  }
});

// Update user logout status
router.post("/user-status/logout", auth, async (req, res) => {
  try {
    const { id: userId, organizationId } = req.user;

    await UserStatus.findOneAndUpdate(
      { userId, organizationId },
      {
        isLoggedIn: false,
        lastLogoutTime: new Date(),
        deviceStatus: "offline",
        isOnCall: false,
        currentCallStartTime: null,
        currentCallNumber: null,
        autoDialerStatus: "stopped",
        callStatus: "idle",
      },
      { upsert: true, new: true }
    );

    res.json({ success: true, message: "Logout status updated" });
  } catch (error) {
    console.error("Error updating logout status:", error);
    res.status(500).json({ error: "Failed to update logout status" });
  }
});

// Update call status
router.post("/user-status/call", auth, async (req, res) => {
  try {
    const userId = req.user.id; // FIXED: Use req.user.id instead of destructuring _id
    const { isOnCall, callStatus, phoneNumber, callStartTime } = req.body;

    const updateData = {
      isOnCall,
      callStatus,
      lastActivity: new Date(),
    };

    if (isOnCall && phoneNumber) {
      updateData.currentCallNumber = phoneNumber;
      updateData.currentCallStartTime = callStartTime || new Date();
    } else {
      updateData.currentCallNumber = null;
      updateData.currentCallStartTime = null;
    }

    await UserStatus.findOneAndUpdate(
      { userId, organizationId: req.user.organizationId },
      {
        ...updateData,
        $setOnInsert: { organizationId: req.user.organizationId },
      },
      {
        upsert: true,
        new: true,
      }
    );

    res.json({ success: true, message: "Call status updated" });
  } catch (error) {
    console.error("Error updating call status:", error);
    res.status(500).json({ error: "Failed to update call status" });
  }
});

// Update auto dialer status
router.post("/user-status/autodialer", auth, async (req, res) => {
  try {
    const { id: userId, organizationId } = req.user;
    const { autoDialerStatus } = req.body;

    await UserStatus.findOneAndUpdate(
      { userId, organizationId },
      {
        autoDialerStatus,
        lastActivity: new Date(),
      },
      { upsert: true, new: true }
    );

    res.json({ success: true, message: "Auto dialer status updated" });
  } catch (error) {
    console.error("Error updating auto dialer status:", error);
    res.status(500).json({ error: "Failed to update auto dialer status" });
  }
});

// Get real-time status of all users (for owner/admin)
router.get("/user-status/all", auth, async (req, res) => {
  try {
    const { role, id: userId, organizationId } = req.user;
    let userQuery = {};

    switch (role) {
      case "owner":
        // Owner can see all users in their organization
        userQuery = {};
        break;
      case "admin":
        // Admin can see agents they created in their organization
        const agentsCreatedByAdmin = await User.find({
          createdBy: userId,
          organizationId,
          role: "agent",
        }).select("_id");

        const agentIds = agentsCreatedByAdmin.map((agent) => agent._id);
        agentIds.push(userId); // Include admin themselves
        userQuery = { _id: { $in: agentIds } };
        break;
      default:
        return res.status(403).json({ error: "Access denied" });
    }

    const users = await User.find({
      ...userQuery,
      organizationId: req.user.organizationId,
    }).select("username role createdBy");

    const userStatuses = await UserStatus.find({
      userId: { $in: users.map((u) => u._id) },
      organizationId: req.user.organizationId,
    }).populate("userId", "username role");

    // Calculate Pakistani time zone day boundaries
    const now = new Date();
    const pakistaniTime = new Date(now.getTime() + 5 * 60 * 60 * 1000);

    let dayStart, dayEnd;

    if (pakistaniTime.getHours() >= 18) {
      // If it's after 6 PM, day starts today at 6 PM
      dayStart = new Date(pakistaniTime);
      dayStart.setHours(18, 0, 0, 0);

      dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);
      dayEnd.setHours(4, 0, 0, 0);
    } else if (pakistaniTime.getHours() < 4) {
      // If it's before 4 AM, day started yesterday at 6 PM
      dayStart = new Date(pakistaniTime);
      dayStart.setDate(dayStart.getDate() - 1);
      dayStart.setHours(18, 0, 0, 0);

      dayEnd = new Date(pakistaniTime);
      dayEnd.setHours(4, 0, 0, 0);
    } else {
      // If it's between 4 AM and 6 PM, use regular day
      dayStart = new Date(pakistaniTime);
      dayStart.setHours(0, 0, 0, 0);
      dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);
    }

    // Convert back to UTC for database query
    const utcDayStart = new Date(dayStart.getTime() - 5 * 60 * 60 * 1000);
    const utcDayEnd = new Date(dayEnd.getTime() - 5 * 60 * 60 * 1000);

    // Get actual call counts from database for accuracy
    const userCallCounts = await Promise.all(
      users.map(async (user) => {
        const callsToday = await CallLog.countDocuments({
          userId: user._id,
          startTime: { $gte: utcDayStart, $lt: utcDayEnd },
        });
        return { userId: user._id, callsToday };
      })
    );

    // Combine user info with status and actual call counts
    const userStatusList = users.map((user) => {
      const status = userStatuses.find(
        (s) => s.userId._id.toString() === user._id.toString()
      );
      const callCount = userCallCounts.find(
        (c) => c.userId.toString() === user._id.toString()
      );

      return {
        userId: user._id,
        username: user.username,
        role: user.role,
        isLoggedIn: status?.isLoggedIn || false,
        isOnCall: status?.isOnCall || false,
        currentCallStartTime: status?.currentCallStartTime,
        currentCallNumber: status?.currentCallNumber,
        autoDialerStatus: status?.autoDialerStatus || "stopped",
        callStatus: status?.callStatus || "idle",
        deviceStatus: status?.deviceStatus || "offline",
        lastActivity: status?.lastActivity,
        lastLoginTime: status?.lastLoginTime,
        totalCallsToday: callCount?.callsToday || 0,
        totalCallTimeToday: status?.totalCallTimeToday || 0,
      };
    });

    res.json({ success: true, userStatuses: userStatusList });
  } catch (error) {
    console.error("Error fetching user statuses:", error);
    res.status(500).json({ error: "Failed to fetch user statuses" });
  }
});

// === LICENSE AGENT SETTINGS ROUTES ===
const LicenseAgentSettings = require("../models/LicenseAgentSettings");

// Get license agent settings (Organization-based)
router.get("/license-agent-settings", auth, async (req, res) => {
  try {
    const { role, organizationId } = req.user;

    // Get settings for the user's organization
    let settings = await LicenseAgentSettings.findOne({ organizationId });

    if (!settings) {
      // Create default settings if none exist (only if requesting user is owner)
      if (role === "owner") {
        settings = new LicenseAgentSettings({
          organizationId,
          agents: [
            {
              id: "agent1",
              name: "License Agent 1",
              phoneNumber: "+1234567890",
              isActive: true,
            },
            {
              id: "agent2",
              name: "License Agent 2",
              phoneNumber: "+1234567891",
              isActive: true,
            },
            {
              id: "agent3",
              name: "License Agent 3",
              phoneNumber: "+1234567892",
              isActive: true,
            },
          ],
          holdMusicEnabled: true,
          holdMusicUrl: "",
        });
        await settings.save();
      } else {
        // For non-owners, return empty default settings if none exist
        settings = {
          agents: [
            {
              id: "agent1",
              name: "License Agent 1",
              phoneNumber: "",
              isActive: false,
            },
            {
              id: "agent2",
              name: "License Agent 2",
              phoneNumber: "",
              isActive: false,
            },
            {
              id: "agent3",
              name: "License Agent 3",
              phoneNumber: "",
              isActive: false,
            },
          ],
          holdMusicEnabled: true,
          holdMusicUrl: "",
        };
      }
    }

    res.json({ success: true, settings });
  } catch (error) {
    console.error("Error fetching license agent settings:", error);
    res.status(500).json({ error: "Failed to fetch license agent settings" });
  }
});

// Update license agent settings (Owner only) - Organization-based
router.put("/license-agent-settings", auth, async (req, res) => {
  try {
    const { role, organizationId } = req.user;
    const { agents, holdMusicEnabled, holdMusicUrl } = req.body;

    if (role !== "owner") {
      return res
        .status(403)
        .json({ error: "Only owners can update license agent settings" });
    }

    // Validate agents array
    if (!Array.isArray(agents) || agents.length !== 3) {
      return res.status(400).json({ error: "Must provide exactly 3 agents" });
    }

    // Validate each agent
    for (const agent of agents) {
      if (!agent.name || !agent.phoneNumber) {
        return res
          .status(400)
          .json({ error: "Agent name and phone number are required" });
      }
    }

    let settings = await LicenseAgentSettings.findOne({ organizationId });

    if (!settings) {
      settings = new LicenseAgentSettings({ organizationId });
    }

    settings.agents = agents;
    settings.holdMusicEnabled = holdMusicEnabled || false;
    settings.holdMusicUrl = holdMusicUrl || "";
    settings.updatedAt = new Date();

    await settings.save();

    res.json({ success: true, settings });
  } catch (error) {
    console.error("Error updating license agent settings:", error);
    res.status(500).json({ error: "Failed to update license agent settings" });
  }
});

module.exports = router;
