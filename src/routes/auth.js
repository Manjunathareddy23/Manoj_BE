const express = require('express');
const { googleLogin, completeProfile, getCurrentUser, updateProfile } = require('../controllers/authController');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

router.post('/google', googleLogin);
router.post('/complete-profile', authenticateToken, completeProfile);
router.get('/me', authenticateToken, getCurrentUser);
router.put('/profile', authenticateToken, updateProfile);

module.exports = router;
