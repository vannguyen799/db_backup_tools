#!/usr/bin/env node
import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'

const uri = process.env.MONGODB_URI
const email = (process.env.ADMIN_EMAIL || '').toLowerCase().trim()
const password = process.env.ADMIN_PASSWORD || ''
const name = process.env.ADMIN_NAME || 'Admin'

if (!uri) throw new Error('MONGODB_URI is required')
if (!email || !password) throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD are required')

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true },
    password: { type: String, required: true },
    role: { type: String, enum: ['admin'], default: 'admin' },
    lastLoginAt: { type: Date },
  },
  { timestamps: true },
)
const User = mongoose.model('User', userSchema)

await mongoose.connect(uri)
console.log('Connected to', mongoose.connection.name)

const existing = await User.findOne({ email })
const hash = await bcrypt.hash(password, 12)

if (existing) {
  existing.password = hash
  existing.name = name
  existing.role = 'admin'
  await existing.save()
  console.log(`Updated admin user: ${email}`)
} else {
  await User.create({ email, name, password: hash, role: 'admin' })
  console.log(`Created admin user: ${email}`)
}

await mongoose.disconnect()
