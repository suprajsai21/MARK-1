import { z } from 'zod';

const normalizedEmail = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .email();

const registerInputShape = {
  email: normalizedEmail,
  password: z.string().min(12).max(128),
};

export const RegisterInputSchema = z.object(registerInputShape).strict();
export type RegisterInput = z.infer<typeof RegisterInputSchema>;

export const LoginInputSchema = z.object({
  email: normalizedEmail,
  password: z.string().min(12).max(128),
}).strict();
export type LoginInput = z.infer<typeof LoginInputSchema>;

export const AuthUserSchema = z.object({
  id: z.string().min(1),
  email: z.string().max(254).email().refine((email) => email === email.trim().toLowerCase()),
  emailVerified: z.boolean(),
  role: z.enum(['customer', 'admin']),
}).strict();
export type AuthUser = z.infer<typeof AuthUserSchema>;

export const ApiErrorSchema = z.object({
  code: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
  message: z.string().min(1).max(500),
}).strict();
export type ApiError = z.infer<typeof ApiErrorSchema>;
