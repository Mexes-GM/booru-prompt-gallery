import { SignJWT, jwtVerify } from 'jose'

const secretKey = process.env.SESSION_SECRET || 'default-secret-change-me-in-prod'
const key = new TextEncoder().encode(secretKey)

export type SessionPayload = {
  role: string
  expires: Date
  [key: string]: unknown
}

export async function encrypt(payload: SessionPayload) {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(key)
}

export async function decrypt(input: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(input, key, {
      algorithms: ['HS256'],
    })
    return payload as SessionPayload
  } catch (error) {
    return null
  }
}
