import React from 'react';
import { AuthPage } from './AuthPage';

export const LoginPage: React.FC = () => {
  return <AuthPage initialTab="signin" />;
};

export default LoginPage;
