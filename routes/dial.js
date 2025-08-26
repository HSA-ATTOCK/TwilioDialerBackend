const express = require("express");
const CallLog = require("../models/CallLog");
const DialList = require("../models/DialList");
const User = require("../models/User");
const UserStatus = require("../models/UserStatus");
const { verifyToken: auth } = require("../routes/auth"); // Add this line
const router = express.Router();

// Get reports with role-based filtering - Updated to use DialList
router.get("/reports", async (req, res) => {
  try {
    const { role, _id: userId } = req.user;
    let query = {};
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
        // Owner can see ALL reports from everyone
        query = { dialingStatus: "completed" };
        console.log("Owner can see all completed reports");
        break;

      case "admin":
        // Admin can see reports from agents they created
        const agentsCreatedByAdmin = await User.find({
          createdBy: userId,
          role: "agent",
        }).select("_id");

        const agentIds = agentsCreatedByAdmin.map((agent) => agent._id);
        agentIds.push(userId); // Include admin's own reports

        query = {
          assignedTo: { $in: agentIds },
          dialingStatus: "completed",
        };
        console.log("Admin query:", query);
        break;

      case "agent":
        // Agents can only see their own reports
        query = {
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
    const { role, _id: userId } = req.user;
    let query = {};

    switch (role) {
      case "owner":
        // Owner can see ALL call logs
        query = {};
        break;
      case "admin":
        // Admin can see call logs from agents they created
        const adminAgents = await User.find({
          createdBy: userId,
          role: "agent",
        });
        const agentIds = adminAgents.map((agent) => agent._id);
        agentIds.push(userId); // Include admin's own call logs
        query = { userId: { $in: agentIds } };
        break;
      case "agent":
        // Agents can only see their own call logs
        query = { userId };
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

// Upload numbers file (owner/admin can upload and assign to agents)
router.post("/upload-numbers", auth, async (req, res) => {
  try {
    const { role, _id: userId } = req.user;

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
        // Check if number already exists
        const existingNumber = await DialList.findOne({ phoneNumber: number });

        if (existingNumber) {
          // Reset calling status while preserving disposition and comments
          await DialList.updateOne(
            { phoneNumber: number },
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

// Get available agents for number assignment
router.get("/available-agents", auth, async (req, res) => {
  try {
    const { role, _id: userId } = req.user;
    let query = {};

    if (role === "owner") {
      // Owner can see all agents and admins
      query = { role: { $in: ["admin", "agent"] } };
    } else if (role === "admin") {
      // Admin can see themselves and agents they created
      query = {
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
    const { _id: userId } = req.user;

    const numbers = await DialList.find({
      assignedTo: userId,
      dialingStatus: { $in: ["pending", "failed", "no_answer", "busy"] }, // Only get numbers that can be dialed
    })
      .sort({ priority: -1, createdAt: 1 }) // Higher priority first, then oldest first
      .limit(1000); // Limit for performance

    res.json(numbers);
  } catch (error) {
    console.error("Error fetching user numbers:", error);
    res.status(500).json({ error: "Failed to fetch numbers" });
  }
});

// Get next number to dial (with locking mechanism)
router.post("/get-next-number", auth, async (req, res) => {
  try {
    const { _id: userId } = req.user;

    // Find the next available number that has never been completed
    // Only get numbers that are truly pending (never dialed before)
    const nextNumber = await DialList.findOneAndUpdate(
      {
        assignedTo: userId,
        dialingStatus: "pending", // Only get pending numbers, not failed/busy/no_answer
        currentlyDialingBy: null, // Not currently being dialed by someone else
        attempts: 0, // Only numbers that have never been attempted
      },
      {
        dialingStatus: "dialing",
        currentlyDialingBy: userId,
        lastDialedAt: new Date(),
        $inc: { attempts: 1 },
      },
      {
        new: true,
        sort: { priority: -1, createdAt: 1 }, // Higher priority first, then oldest first
      }
    );

    if (!nextNumber) {
      return res.json({
        success: false,
        message: "No more numbers available to dial",
        hasMore: false,
      });
    }

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
    const { _id: userId } = req.user;
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
    const { _id: userId } = req.user;
    const { numberId } = req.body;

    if (!numberId) {
      return res.status(400).json({ error: "Number ID is required" });
    }

    const updatedNumber = await DialList.findOneAndUpdate(
      {
        _id: numberId,
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
    const { _id: userId } = req.user;

    const stats = await DialList.aggregate([
      { $match: { assignedTo: userId } },
      {
        $group: {
          _id: "$dialingStatus",
          count: { $sum: 1 },
        },
      },
    ]);

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
            { userId },
            { $inc: { totalCallsToday: 1 } },
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

    const dialListUpdate = await DialList.findOneAndUpdate(
      {
        phoneNumber: phoneNumber,
        assignedTo: req.user.id, // Only update if assigned to current user
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
    const { _id: userId } = req.user;

    await UserStatus.findOneAndUpdate(
      { userId },
      {
        isLoggedIn: true,
        lastLoginTime: new Date(),
        deviceStatus: "ready",
        lastActivity: new Date(),
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
    const { _id: userId } = req.user;

    await UserStatus.findOneAndUpdate(
      { userId },
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
    const { _id: userId } = req.user;
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

    await UserStatus.findOneAndUpdate({ userId }, updateData, {
      upsert: true,
      new: true,
    });

    res.json({ success: true, message: "Call status updated" });
  } catch (error) {
    console.error("Error updating call status:", error);
    res.status(500).json({ error: "Failed to update call status" });
  }
});

// Update auto dialer status
router.post("/user-status/autodialer", auth, async (req, res) => {
  try {
    const { _id: userId } = req.user;
    const { autoDialerStatus } = req.body;

    await UserStatus.findOneAndUpdate(
      { userId },
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
    const { role, _id: userId } = req.user;
    let userQuery = {};

    switch (role) {
      case "owner":
        // Owner can see all users
        userQuery = {};
        break;
      case "admin":
        // Admin can see agents they created
        const agentsCreatedByAdmin = await User.find({
          createdBy: userId,
          role: "agent",
        }).select("_id");

        const agentIds = agentsCreatedByAdmin.map((agent) => agent._id);
        agentIds.push(userId); // Include admin themselves
        userQuery = { _id: { $in: agentIds } };
        break;
      default:
        return res.status(403).json({ error: "Access denied" });
    }

    const users = await User.find(userQuery).select("username role createdBy");
    const userStatuses = await UserStatus.find({
      userId: { $in: users.map((u) => u._id) },
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

// Get license agent settings (All authenticated users can read, but gets owner's settings)
router.get("/license-agent-settings", auth, async (req, res) => {
  try {
    const { role, _id: userId } = req.user;

    let ownerId = userId;

    // If user is not owner, find the owner they belong to
    if (role !== "owner") {
      if (role === "admin") {
        // Admin: find the owner who created them
        const adminUser = await User.findById(userId).populate("createdBy");
        if (
          adminUser &&
          adminUser.createdBy &&
          adminUser.createdBy.role === "owner"
        ) {
          ownerId = adminUser.createdBy._id;
        } else {
          // If admin wasn't created by owner, find any owner (fallback)
          const owner = await User.findOne({ role: "owner" });
          ownerId = owner ? owner._id : userId;
        }
      } else if (role === "agent") {
        // Agent: find the admin or owner who created them
        const agentUser = await User.findById(userId).populate("createdBy");
        if (agentUser && agentUser.createdBy) {
          if (agentUser.createdBy.role === "owner") {
            ownerId = agentUser.createdBy._id;
          } else if (agentUser.createdBy.role === "admin") {
            // Agent created by admin, find the owner who created that admin
            const adminUser = await User.findById(
              agentUser.createdBy._id
            ).populate("createdBy");
            if (
              adminUser &&
              adminUser.createdBy &&
              adminUser.createdBy.role === "owner"
            ) {
              ownerId = adminUser.createdBy._id;
            } else {
              // Fallback to any owner
              const owner = await User.findOne({ role: "owner" });
              ownerId = owner ? owner._id : userId;
            }
          }
        } else {
          // Fallback to any owner
          const owner = await User.findOne({ role: "owner" });
          ownerId = owner ? owner._id : userId;
        }
      }
    }

    let settings = await LicenseAgentSettings.findOne({ ownerId });

    if (!settings) {
      // Create default settings if none exist (only if requesting user is owner)
      if (role === "owner") {
        settings = new LicenseAgentSettings({
          ownerId,
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

// Update license agent settings (Owner only)
router.put("/license-agent-settings", auth, async (req, res) => {
  try {
    const { role, _id: userId } = req.user;
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

    let settings = await LicenseAgentSettings.findOne({ ownerId: userId });

    if (!settings) {
      settings = new LicenseAgentSettings({ ownerId: userId });
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
