import User from "../models/user.model.js";
import Post from "../models/post.model.js";
import 'dotenv/config';
import TempOTP from "../models/TempOTP.js";
import nodemailer from "nodemailer";
import crypto from "crypto";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { body, validationResult } from "express-validator";
import 'dotenv/config';
import { OAuth2Client } from "google-auth-library";
import sendEmail from "../lib/sendEmail.js";

//Get all users
export const getAllUser = async (req, res) => {
  try {
    const users = await User.find()
     .select("_id username email role isBanned ")
     .sort({ createdAt: -1 });
     
    res.status(200).json(users);
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({ message: "Failed to fetch users" });
  }
}

// Delete user
export const DeleteUser = async (req, res) => {
 const { id } = req.params;
 try {
    const user = await User.findByIdAndDelete(id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    res.status(200).json({ message: "User deleted successfully" });
 }
 catch(error){
    res.status(500).json({ message: "Failed to delete user" });
  }
 }

// Ban user
export const BanUser = async (req, res) => {
  
  if (!req.user || req.user.role !== "admin") {
    return res.status(401).json({ message: "Not authorized" });
  }

  try {
    const { id } = req.params;
    const user = await User.findById(id);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    user.isBanned = !user.isBanned; // Toggle ban status
    await user.save();
    
    res.status(200).json({ message: `User ${user.isBanned ? 'banned' : 'unbanned'} successfully` });
  } catch (error) {
    console.error('Error banning/unbanning user', error);
    res.status(500).json({ message: 'Failed to ban/unban user' });
  }

}


// Request OTP Controller
export const requestOtp = async (req, res) => {
  const { email } = req.body;

  try {
      console.log("Received email:", email);

      const existingUser = await User.findOne({ email });
      if (existingUser) {
        console.log("Email already registered");
        return res.status(400).json({ message: "Email already registered" });
      }

      const otp = crypto.randomInt(100000, 999999).toString();
      const otpExpires = new Date(Date.now() + 10 * 60 * 1000);
      console.log("Generated OTP:", otp);

    

    // Send OTP email
  try{ 
    await sendEmail({
      to: email,
      subject: "Your OTP Code",
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.6;">
          <h2>Verification Code</h2>
          <p>Your OTP code is:</p>
          <h1 style="background: #f3f4f6; display: inline-block; padding: 10px 20px; border-radius: 8px;">${otp}</h1>
          <p>This code will expire in 10 minutes.</p>
          <p>If you didn't request this, please ignore this email.</p>
        </div>
      `,
    });
    
      console.log("OTP email sent");


   // Save OTP to TempOTP collection
      await TempOTP.findOneAndUpdate(
        { email },
        { email, otp, otpExpires },
        { upsert: true, new: true }
      );
      console.log("OTP saved to TempOTP collection");

      res.status(200).json({ message: "OTP sent successfully" });
    } catch (emailError) {
      console.error("Error sending OTP email:", emailError);
      return res.status(500).json({ message: "Error sending OTP email" });
    }
  } catch (error) {
    console.error("Error in requestOtp:", error);
    res.status(500).json({ message: "Error sending OTP", error });
  }
};


// Verify OTP and register user
export const verifyAndRegister = async (req, res) => {
  const { username, email, password ,otp,sex,img} = req.body;
  
  try {
    // Find the temporary OTP entry
    const tempOtp = await TempOTP.findOne({ email });
    
    // Check if OTP exists and is valid
    if (!tempOtp) {
      return res.status(404).json({ message: "No OTP request found. Please request an OTP first." });
    }
    
    if (tempOtp.otp !== otp) {
      return res.status(400).json({ message: "Invalid OTP code" });
    }
    
    if (tempOtp.otpExpires < Date.now()) {
      return res.status(400).json({ message: "OTP has expired. Please request a new one." });
    }
    
    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10); // 10 is the salt rounds
    
    // Validate the img field (optional)
    const validatedImg = img && img.startsWith("http") ? img : "";



    // OTP is valid, now create the user
    const user = new User({
      username,
      email,
      img:validatedImg,
      bio: "",
      password: hashedPassword,
      savedPosts: [], 
      sex,
      isVerified: true // User is pre-verified since OTP is confirmed
    });
    
    await user.save();
    
    // Remove the temporary OTP entry
    await TempOTP.findOneAndDelete({ email });
    
    res.status(201).json({ message: "User registered successfully" });
  } catch (error) {
    console.error("Error registering user:", error); // Log the error details
    res.status(500).json({ message: "Error registering user", error });
  }
};




// This controller handles user login
export const Login = async (req, res) => {
  const { email, password } = req.body;

  try {
    // Sanitize and validate input
    await body("email").isEmail().normalizeEmail().run(req);
    await body("password").notEmpty().trim().escape().run(req);

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    // Check if the user exists
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Verify the password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    // Create a JWT
    const token = jwt.sign(
      { id: user._id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "1d" } // Token expires in 1 hour
    );

    res.status(200).json({
      message: "Login successful",
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        img: user.img,
      },
    });
  } catch (error) {
    console.error("Error in Login:", error);
    res.status(500).json({ message: "Error logging in", error });
  }
};


/// This controller handles user Google Login
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

export const GoogleLogin = async (req, res) => {
  try {
    const { token } = req.body;

    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const { email, name, picture } = payload;

    let user = await User.findOne({ email });

    if (!user) {
      user = await User.create({
        username: name,
        email,
        img: picture,
        bio: "",
        password: null,
        savedPosts: [],
        role: "user",
        isVerified: true,
        isGoogleUser: true,
      });
    }

    const jwtToken = jwt.sign(
      { id: user._id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    res.status(200).json({
      message: "Login successful",
      jwtToken,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
      },
    });

  } catch (err) {
    console.error("Google login error:", err);
    res.status(401).json({ message: "Authentication failed" });
  }
};


export const getUserSavedPosts = async (req, res) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) {
      return res.status(401).json("Not authenticated!");
    }

    const decodedToken = jwt.verify(token, process.env.JWT_SECRET);
    if (!decodedToken) {
      return res.status(401).json("Invalid token");
    }

    const user = await User.findById(decodedToken.id).populate("savedPosts");

    if (!user) {
      return res.status(404).json("User not found");
    }

    res.status(200).json(user.savedPosts);
  } catch (error) {
    console.error("Error getting saved posts:", error);
    res.status(500).json("Something went wrong");
  }
};




export const savePost = async (req, res) => {
  const token = req.headers.authorization.split(" ")[1];
  const decodedToken = jwt.verify(token, process.env.JWT_SECRET);

  const postId = req.body.postId;

  if (!decodedToken) {
    return res.status(401).json("Not authenticated!");
  }

  const user = await User.findOne({ _id: decodedToken.id });

  const isSaved = user.savedPosts.some((p) => p === postId);

  if (!isSaved) {
    await User.findByIdAndUpdate(user._id, {
      $push: { savedPosts: postId },
    });
  } else {
    await User.findByIdAndUpdate(user._id, {
      $pull: { savedPosts: postId },
    });
  }

  res.status(200).json(isSaved ? "Post unsaved" : "Post saved");
};





export const getAuthor = async (req, res) => {
  try {
    const { username } = req.params;

    const token = req.headers.authorization?.split(" ")[1];
    const decodedToken = token ? jwt.verify(token, process.env.JWT_SECRET) : null;
    const viewerId = decodedToken ? decodedToken.id : null;

    // Find the author by username
    const author = await User.findOne({ username }).select("username img bio role followers following createdAt");
    if (!author) {
      return res.status(404).json({ message: "Author not found" });
    }

    // Check if the viewer is following the author
    const isFollowing = viewerId ? author.followers.includes(viewerId) : false;

    // Find the posts by the author
    const posts = await Post.find({ user: author._id })
       .populate("user", "username img")
       .select("title desc slug img createdAt category");

    // Add isFollowing manually
    const authorData = {
      _id: author._id,
      username: author.username,
      img: author.img,
      bio: author.bio,
      role: author.role,
      followers: author.followers,
      following: author.following,
      createdAt: author.createdAt,
      isFollowing,
    };

    res.status(200).json({ authorData, posts });
  } catch (error) {
    console.error("Error fetching author data:", error);
    res.status(500).json({ message: "Failed to fetch author data" });
  }
};




export const getUserProfile = async (req, res)=>{
  try {
    const { username } = req.params;

    // Find the user by username
    const user = await User.findOne({ username }).select("username img bio role");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Find posts created by the user
    const posts = await Post.find({ user: user._id }).select("title desc slug img createdAt").populate("user", "username img");

    res.status(200).json({ user, posts });
  } catch (error) {
    console.error("Error fetching user profile:", error);
    res.status(500).json({ message: "Failed to fetch user profile" });
  }
}

// This controller handles updating the user's profile
export const updateProfile = async (req, res) => {
  try {
    
    console.log("REQ.BODY:", req.body);         // 🔍 log bio and img
    console.log("USER ID:", req.user?.id);     


    const { bio, img ,username,cbeAccount,phoneNo,byMecoffe} = req.body;
    const userId = req.user.id;

    const updatedData = {};
    if (bio) updatedData.bio = bio;
    if (img) updatedData.img = img;
    if (username) updatedData.username = username;
    if (cbeAccount) updatedData.CBEAccount = cbeAccount;
    if (phoneNo) updatedData.PhoneNumber = phoneNo;
    if (byMecoffe) updatedData.byMecoffe = byMecoffe;


    const updatedUser = await User.findByIdAndUpdate(userId, updatedData, { new: true });

    if (!updatedUser) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json(updatedUser);
  } catch (error) {
    console.error("Error updating profile:", error);
    res.status(500).json({ message: "Failed to update profile", error: error.message });
  }
};

export const updatePassword = async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    const userId = req.user.id;

    // Find the user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Check if the old password is correct
    const isMatch = await bcrypt.compare(oldPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Old password is incorrect" });
    }

    // Hash the new password
    const hashedNewPassword = await bcrypt.hash(newPassword, 10);

    // Update the password
    user.password = hashedNewPassword;

    await User.findByIdAndUpdate(userId, { password: hashedNewPassword});

    res.status(200).json({ message: "Password updated successfully" });
  } catch (error) {
    console.error("Error updating password:", error);
    res.status(500).json({ message: "Failed to update password" });
  }
};



export const updateAuthor = async (req, res)=>{
  try {
    const { bio } = req.body;
    const img = req.file?.path; // Handle file upload if applicable
    const userId = req.user.id; // Extract user ID from the token

    const updatedData = {};
    if (bio) updatedData.bio = bio;
    if (img) updatedData.img = img;

    const updatedUser = await User.findByIdAndUpdate(userId, updatedData, { new: true });
    res.status(200).json(updatedUser);
  } catch (error) {
    res.status(500).json({ message: "Failed to update profile" });
  }
}

export const sendResetPasswordLink = async (req, res) => {
  const { email } = req.body;

  try {
    // 1. Find user by email
    const user = await User.findOne({ email });
    if (!user) {
      // Important: Don't reveal if the email exists or not
      return res.status(200).json({ message: "If that email is registered, a reset link was sent." });
    }

    // 2. Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpire = Date.now() + 30 * 60 * 1000; // expires in 30 mins

    // 3. Save to user record
    user.resetPasswordToken = resetToken;
    user.resetPasswordExpire = resetTokenExpire;
    await user.save();

    // 4. Send email
    const resetUrl = `${process.env.CLIENT_URL}/reset-password?token=${resetToken}`;

    await sendEmail({
      to: user.email,
      subject: "Password Reset Request",
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.5;">
          <h2>Password Reset Request</h2>
          <p>You requested a password reset. Click the button below to reset your password:</p>
          <a href="${resetUrl}" style="display: inline-block; padding: 10px 20px; background-color: #4f46e5; color: white; text-decoration: none; border-radius: 5px;">Reset Password</a>
          <p>If you didn't request this, you can safely ignore this email.</p>
          <p style = "color:blue">Thanks,<br/><h2>Blog Sphere</h2></p>
        </div>
      `,
    });
    

    res.status(200).json({ message: "Reset link sent to your email." });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error sending reset link." });
  }
};

export const resetPassword = async(req, res)=>{
  const { token, newPassword } = req.body;

  try {
    // 1. Find user by reset token
    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpire: { $gt: Date.now() } // Check if token is still valid
    });
    if (!user) {
      return res.status(400).json({ message: "Invalid or expired token." });
    }

    // 2. Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // 3. Update user password and clear reset token
    user.password = hashedPassword;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;
    await user.save();
    res.status(200).json({ message: "Password reset successful." });

}
 catch (error){
    console.error("Error resetting password:", error);
    res.status(500).json({ message: "Error resetting password." });
 }
}

// Get popular authors

export const getPopularAuthors = async (req, res) => {
  try {
    const users = await User.find({}) // Add filter like { role: 'author' } if needed
      .select("username img followers")
      .lean(); // lean() returns plain JS objects

    const sorted = users
      .map(user => ({
        ...user,
        followerCount: (user.followers || []).length, // Fallback added here
      }))
      .sort((a, b) => b.followerCount - a.followerCount)
      .slice(0, 4);

    res.json(sorted);
  } catch (err) {
    console.error("Error fetching popular authors", err);
    res.status(500).json({ message: "Server error" });
  }
};
