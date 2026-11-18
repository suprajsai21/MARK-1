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

const clientId = z.string().min(1).max(256);
const redirectUri = z.string().url().max(2048);
const pkceChallenge = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const verifier = z.string().min(43).max(128).regex(/^[A-Za-z0-9._~-]+$/);
const opaqueToken = z.string().min(1).max(512);
const state = z.string().max(512).refine((value) =>
  [...value].every((character) => {
    const code = character.charCodeAt(0);
    return code >= 0x20 && code !== 0x7f;
  }),
);

export const OAuthAuthorizeQuerySchema = z.object({
  client_id: clientId,
  redirect_uri: redirectUri,
  response_type: z.literal('code'),
  code_challenge: pkceChallenge,
  code_challenge_method: z.literal('S256'),
  state: state.optional(),
}).strict();
export type OAuthAuthorizeQuery = z.infer<typeof OAuthAuthorizeQuerySchema>;

export const OAuthAuthorizationInputSchema = z.object({
  clientId,
  redirectUri,
  codeChallenge: pkceChallenge,
  consented: z.literal(true),
  state: state.optional(),
}).strict();
export type OAuthAuthorizationInput = z.infer<typeof OAuthAuthorizationInputSchema>;

export const OAuthTokenInputSchema = z.discriminatedUnion('grantType', [
  z.object({
    grantType: z.literal('authorization_code'),
    code: opaqueToken,
    clientId,
    redirectUri,
    codeVerifier: verifier,
  }).strict(),
  z.object({
    grantType: z.literal('refresh_token'),
    refreshToken: opaqueToken,
    clientId,
  }).strict(),
]);
export type OAuthTokenInput = z.infer<typeof OAuthTokenInputSchema>;

export const OAuthRevokeInputSchema = z.object({ token: opaqueToken, clientId }).strict();
export type OAuthRevokeInput = z.infer<typeof OAuthRevokeInputSchema>;
