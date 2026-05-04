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
    const name = googlePayload.name || 'User';

    if (!googleId || !email) {
      return res.status(400).json({ message: 'Invalid Google token payload' });
    }

    // Try to find existing user by Google ID
    const [users] = await pool.query(
      'SELECT * FROM users WHERE google_id = ?',
      [googleId]
    );

    let user;

    if (users.length === 0) {
      // Create new user with Google info and selected role
      try {
        const [result] = await pool.query(
          'INSERT INTO users (name, email, google_id, role) VALUES (?, ?, ?, ?)',
          [name, email, googleId, userRole]
        );
        user = {
          id: result.insertId,
          google_id: googleId,
          role: userRole,
          name: name,
          email: email,
        };
      } catch (dbError) {
        if (dbError.code === 'ER_DUP_ENTRY') {
          // Email already exists (possibly from email signup)
          return res.status(400).json({
            message: 'Email already registered. Please sign in instead.',
          });
        }
        throw dbError;
      }
    } else {
      user = users[0];
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
        name: user.name,
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

    res.json({ user: users[0] });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ message: 'Fetch failed' });
  }
};

// Update Profile
const updateProfile = async (req, res) => {
  try {
    const { name, phone, location } = req.body;
    const userId = req.user.id;

    // DB columns: whatsapp (phone), place (location)
    await pool.query(
      'UPDATE users SET name = ?, whatsapp = ?, place = ? WHERE id = ?',
      [name || null, phone || null, location || null, userId]
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

module.exports = {
  googleLogin,
  completeProfile,
  getCurrentUser,
  updateProfile,
};
