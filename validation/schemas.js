const { z } = require("zod");

const email = z.string().trim().email();
const password = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password is too long");

const signupSchema = z.object({
  medicalName: z.string().trim().min(2).max(100),
  ownerName: z.string().trim().min(2).max(50),
  address: z.string().trim().min(5).max(200),
  email,
  contactNo: z.string().trim().min(7).max(20),
  drugLicenseNo: z.string().trim().min(4).max(40),
  password,
});

const loginSchema = z.object({
  email,
  password,
  role: z.enum(["stockist", "medicalOwner", "purchaser", "staff"]),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(20),
});

const forgotPasswordSchema = z.object({ email });

const resetPasswordSchema = z.object({
  token: z.string().min(20),
  email,
  newPassword: password,
});

const updateProfileSchema = z
  .object({
    medicalName: z.string().trim().min(2).max(100).optional(),
    ownerName: z.string().trim().min(2).max(50).optional(),
    address: z.string().trim().min(5).max(200).optional(),
    contactNo: z.string().trim().min(7).max(20).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one profile field is required",
  });

const purchaserSignupSchema = z.object({
  fullName: z.string().trim().min(2).max(100),
  email,
  password,
  address: z.string().trim().min(5).max(200),
  contactNo: z.string().trim().min(7).max(20),
});

const purchaserCreateSchema = purchaserSignupSchema;

const staffCreateSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  contact: z.string().trim().min(7).max(20),
  email: email.optional(),
  address: z.string().trim().max(200).optional(),
  password: z.string().min(6).max(128).optional(),
  currentWorkingPlace: z.string().trim().max(200).optional(),
  isFresher: z.union([z.boolean(), z.string()]).optional(),
  stockist: z.string().trim().optional(),
  workForType: z.enum(["stockist", "medical"]).optional(),
  workForId: z.string().trim().optional(),
  workForName: z.string().trim().min(2).max(120).optional(),
});

const stockistReferenceSchema = z.union([
  z.string().trim().min(1),
  z
    .object({
      _id: z.string().trim().min(1).optional(),
      id: z.string().trim().min(1).optional(),
      value: z.string().trim().min(1).optional(),
      name: z.string().trim().min(1).optional(),
      label: z.string().trim().min(1).optional(),
    })
    .refine((obj) => obj._id || obj.id || obj.value || obj.name || obj.label, {
      message: "Stockist object must contain _id, id, value, name, or label",
    }),
]);

const companyCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional(),
  active: z.boolean().optional(),
  stockists: z.array(stockistReferenceSchema).optional(),
});

const companyReferenceSchema = z.union([
  z.string().trim().min(1),
  z
    .object({
      _id: z.string().trim().min(1).optional(),
      id: z.string().trim().min(1).optional(),
      value: z.string().trim().min(1).optional(),
    })
    .refine((obj) => obj._id || obj.id || obj.value, {
      message: "Company object must contain _id, id, or value",
    }),
]);

const medicineCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  genericName: z.string().trim().max(120).optional(),
  manufacturer: z.string().trim().max(120).optional(),
  price: z.preprocess((val) => {
    if (typeof val === "string") {
      const num = Number(val.trim());
      return Number.isFinite(num) ? num : val;
    }
    return val;
  }, z.number().nonnegative().optional()),
  category: z.string().trim().max(120).optional(),
  company: companyReferenceSchema.optional(),
  stockists: z.array(stockistReferenceSchema).optional(),
  stockistIds: z.array(stockistReferenceSchema).optional(),
});

const stockistCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  contactPerson: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(20).optional(),
  email: email.optional(),
  password: password.optional(),
  licenseNumber: z.string().trim().max(60).optional(),
});

module.exports = {
  signupSchema,
  loginSchema,
  refreshSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  updateProfileSchema,
  purchaserSignupSchema,
  purchaserCreateSchema,
  staffCreateSchema,
  companyCreateSchema,
  medicineCreateSchema,
  stockistCreateSchema,
};
