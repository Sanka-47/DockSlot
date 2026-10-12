import { Request, Response, NextFunction } from 'express';

export const authenticate = (_req: Request, _res: Response, next: NextFunction) => {
  next();
};
