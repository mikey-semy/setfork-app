import 'dotenv/config'
import type { Config } from 'drizzle-kit'

export default {
  schema: './src/shared/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
  strict: true,
} satisfies Config
