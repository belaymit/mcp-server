# Login Feature Documentation

This document describes the user login flow for the NexusAI platform.

## UI Elements
- Username field (email validation)
- Password field (minimum 8 characters)
- Login Button (See ui_guidelines.md for styling)
- "Remember Me" checkbox
- "Forgot Password" link

## Authentication Flow
1. User enters credentials
2. Client-side validation
3. API call to `/auth/login`
4. JWT token returned on success
5. Token stored in secure cookie

## Known Issues
- Alignment on mobile (NEX-123) - Fixed in commit_abc123
- Password reset flow needs improvement

## Security Considerations
- Rate limiting on login attempts
- HTTPS required for production
- JWT tokens expire after 24 hours