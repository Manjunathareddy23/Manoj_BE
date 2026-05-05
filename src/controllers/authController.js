const pool = require('../config/database');
const jwt = require('jsonwebtoken');
const config = require('../config');

// Decode JWT without verification to extract claims
const decodeGoogleToken = (token) => {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid token format');
    }
    
    // Decode the payload (second part)
    const decoded = JSON.parse(
      Buffer.from(parts[1], 'base64').toString('utf-8')
    );
    
    return decoded;
  } catch (error) {
    console.error('Token decode error:', error);
    throw new Error('Invalid Google token');
  }
};

// Google Login
const googleLogin = async (req, res) => {
  try {
    const { token, role } = req.body;

    if (!token) {
      return res.status(400).json({ message: 'Google token is required' });
    }

    // Validate role if provided
    const userRole = role && ['farmer', 'consumer'].includes(role) ? role : 'consumer';

    // Decode the Google JWT token
    const googlePayload = decodeGoogleToken(token);
    
    const googleId = googlePayload.sub; // Google's unique user ID
    const email = googlePayload.email;
    const fullName = googlePayload.name || 'User';
    const nameParts = fullName.split(' ');
    const firstName = nameParts[0] || 'User';
    const lastName = nameParts.slice(1).join(' ') || '';

    if (!googleId || !email) {
      return res.status(400).json({ message: 'Invalid Google token payload' });
    }

    // Try to find existing user by Google ID or email
    let [users] = await pool.query(
      'SELECT * FROM users WHERE google_id = ? OR email = ?',
      [googleId, email]
    );

    let user;

    if (users.length === 0) {
      // Create new user with Google info and selected role
      try {
        const [result] = await pool.query(
          'INSERT INTO users (first_name, last_name, email, google_id, role) VALUES (?, ?, ?, ?, ?)',
          [firstName, lastName, email, googleId, userRole]
        );
        user = {
          id: result.insertId,
          google_id: googleId,
          role: userRole,
          first_name: firstName,
          last_name: lastName,
          email: email,
        };
      } catch (dbError) {
        if (dbError.code === 'ER_DUP_ENTRY') {
          return res.status(400).json({
            message: 'Email already registered. Please sign in instead.',
          });
        }
        throw dbError;
      }
    } else {
      user = users[0];
      // Update google_id if missing
      if (!user.google_id) {
        await pool.query('UPDATE users SET google_id = ? WHERE id = ?', [googleId, user.id]);
        user.google_id = googleId;
      }
    }

    // Create JWT token
    const jwtToken = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn }
    );

    res.json({
      token: jwtToken,
      user: {
        id: user.id,
        name: `${user.first_name || ''} ${user.last_name || ''}`.trim(),
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    console.error('Google login error:', error);
    res.status(500).json({ message: 'Login failed', error: error.message });
  }
};

// Complete Profile (Select Role)
const completeProfile = async (req, res) => {
  try {
    const { role } = req.body;
    const userId = req.user.id;

    const [result] = await pool.query(
      'UPDATE users SET role = ? WHERE id = ?',
      [role, userId]
    );

    const [users] = await pool.query('SELECT * FROM users WHERE id = ?', [userId]);

    res.json({
      message: 'Profile updated',
      user: users[0],
    });
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({ message: 'Update failed' });
  }
};

// Get Current User
const getCurrentUser = async (req, res) => {
  try {
    const [users] = await pool.query('SELECT * FROM users WHERE id = ?', [req.user.id]);

    if (users.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const u = users[0];
    // profile_image is stored as a base64 string; MySQL returns a Buffer — convert back
    if (u.profile_image && Buffer.isBuffer(u.profile_image)) {
      u.profile_image = u.profile_image.toString('utf8');
    }

    res.json({ user: u });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ message: 'Fetch failed' });
  }
};

// Update Profile
const updateProfile = async (req, res) => {
  try {
    const { name, phone, location, profileImage } = req.body;
    const userId = req.user.id;

    const nameParts = (name || '').split(' ');
    const firstName = nameParts[0] || null;
    const lastName = nameParts.slice(1).join(' ') || null;

    if (profileImage !== undefined) {
      await pool.query(
        'UPDATE users SET first_name = ?, last_name = ?, phone = ?, address = ?, profile_image = ? WHERE id = ?',
        [firstName, lastName, phone || null, location || null, profileImage || null, userId]
      );
    } else {
      await pool.query(
        'UPDATE users SET first_name = ?, last_name = ?, phone = ?, address = ? WHERE id = ?',
        [firstName, lastName, phone || null, location || null, userId]
      );
    }

    const [users] = await pool.query('SELECT * FROM users WHERE id = ?', [userId]);
    const u = users[0];
    if (u.profile_image && Buffer.isBuffer(u.profile_image)) {
      u.profile_image = u.profile_image.toString('utf8');
    }
    res.json({
      message: 'Profile updated',
      user: {
        ...u,
        name: `${u.first_name || ''} ${u.last_name || ''}`.trim(),
      },
    });
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({ message: 'Update failed' });
  }
};

module.exports = {
  googleLogin,
  completeProfile,
  getCurrentUser,
  updateProfile,
};
