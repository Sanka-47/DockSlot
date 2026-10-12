import { Request, Response } from 'express';
import { authService } from '../services/auth.service';

export const register = async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await authService.register(req.body);
    res.status(201).json({
      success: true,
      message: 'User registered successfully. A verification email has been sent.',
      data: result,
    });
  } catch (error: any) {
    const status = error.status || 500;
    res.status(status).json({
      success: false,
      message: error.message || 'An error occurred during registration.',
    });
  }
};

export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await authService.login(req.body);
    res.status(200).json({
      success: true,
      message: 'Login successful.',
      data: result,
    });
  } catch (error: any) {
    const status = error.status || 500;
    res.status(status).json({
      success: false,
      message: error.message || 'An error occurred during login.',
    });
  }
};

export const verifyEmail = async (req: Request, res: Response): Promise<void> => {
  try {
    const token = req.query.token as string;
    const result = await authService.verifyEmail(token);
    res.status(200).json({
      success: true,
      message: result.message,
      data: { email: result.email },
    });
  } catch (error: any) {
    const status = error.status || 500;
    res.status(status).json({
      success: false,
      message: error.message || 'Email verification failed.',
    });
  }
};

export const resendVerification = async (req: Request, res: Response): Promise<void> => {
  try {
    const email = req.body.email;
    const userId = req.user?.userId;

    const result = await authService.resendVerification({ email, userId });
    res.status(200).json({
      success: true,
      message: result.message,
    });
  } catch (error: any) {
    const status = error.status || 500;
    res.status(status).json({
      success: false,
      message: error.message || 'Failed to resend verification email.',
    });
  }
};

export const resetPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, oldPassword, newPassword } = req.body;
    const userId = req.user?.userId;

    const result = await authService.resetPassword({
      email,
      userId,
      oldPassword,
      newPassword,
    });

    res.status(200).json({
      success: true,
      message: result.message,
    });
  } catch (error: any) {
    const status = error.status || 500;
    res.status(status).json({
      success: false,
      message: error.message || 'An error occurred during password reset.',
    });
  }
};

export const getMe = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user?.userId) {
      res.status(401).json({
        success: false,
        message: 'Unauthorized.',
      });
      return;
    }

    const user = await authService.getUserById(req.user.userId);
    res.status(200).json({
      success: true,
      data: {
        ...user,
        tenantContext: req.tenant,
      },
    });
  } catch (error: any) {
    const status = error.status || 500;
    res.status(status).json({
      success: false,
      message: error.message || 'Failed to retrieve user profile.',
    });
  }
};
