import { resolve } from 'path'

export default defineNuxtConfig({
  compatibilityDate: '2026-03-12',
  devtools: { enabled: process.env.NODE_ENV !== 'production' },

  srcDir: 'src/',
  serverDir: 'src/server/',

  dir: {
    public: 'src/public/',
    shared: 'src/shared/',
  },

  alias: {
    '$': resolve('./src/server/backend'),
  },

  modules: ['@pinia/nuxt'],

  nitro: {
    esbuild: {
      options: {
        target: 'es2022',
        tsconfigRaw: {
          compilerOptions: {
            experimentalDecorators: true,
          },
        },
      },
    },
  },

  postcss: {
    plugins: {
      '@tailwindcss/postcss': {},
    },
  },

  css: ['~/assets/css/globals.css'],

  app: {
    head: {
      title: 'Mongo Backup',
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      ],
      link: [
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap' },
      ],
    },
  },

  runtimeConfig: {
    mongodbUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/mongo-backup',
    jwtSecret: process.env.JWT_SECRET || '',
    jwtExpire: process.env.JWT_EXPIRE || '30d',
    encryptionKey: process.env.ENCRYPTION_KEY || '',

    adminEmail: process.env.ADMIN_EMAIL || 'admin@local',
    adminPassword: process.env.ADMIN_PASSWORD || '',
    adminName: process.env.ADMIN_NAME || 'Admin',

    googleClientId: process.env.GOOGLE_CLIENT_ID || '',
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    googleRedirectUri:
      process.env.GOOGLE_REDIRECT_URI ||
      `${process.env.APP_URL || 'http://localhost:13280'}/api/gdrive/callback`,

    backupTmpDir: process.env.BACKUP_TMP_DIR || '/tmp/mongo-backup',
    mongodumpBin: process.env.MONGODUMP_BIN || 'mongodump',
    pgDumpBin: process.env.PGDUMP_BIN || 'pg_dump',
    schedulerEnabled: process.env.SCHEDULER_ENABLED !== 'false',
    mcpEnabled: process.env.MCP_ENABLED !== 'false',

    public: {
      appUrl: process.env.APP_URL || 'http://localhost:13280',
    },
  },
})
