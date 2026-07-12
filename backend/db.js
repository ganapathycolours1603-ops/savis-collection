import 'dotenv/config';
import dns from 'dns';
dns.setDefaultResultOrder('ipv4first');
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- DATABASE CONNECTION CONFIGURATION ---
const PG_CONNECTION_STRING = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
const jsonFilePath = path.resolve(__dirname, 'database.json');

export let useLocalJson = false;
let pool = null;

if (!PG_CONNECTION_STRING) {
  console.log("⚠️ No PG database URL found. Falling back to local JSON database mode!");
  useLocalJson = true;
} else {
  console.log("[DATABASE] Database URL found. Creating connection pool...");
  const useSsl = !PG_CONNECTION_STRING.includes('localhost') && !PG_CONNECTION_STRING.includes('127.0.0.1');
  pool = new Pool({
    connectionString: PG_CONNECTION_STRING,
    ssl: useSsl ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 5000
  });
}

function ensureJsonFile() {
  if (!fs.existsSync(jsonFilePath)) {
    const defaultData = {
      products: [],
      orders: [],
      users: [],
      inquiries: [],
      reviews: [],
      cart_activity: [],
      homepage_sections: []
    };
    fs.writeFileSync(jsonFilePath, JSON.stringify(defaultData, null, 2), 'utf8');
  } else {
    try {
      const content = fs.readFileSync(jsonFilePath, 'utf8');
      const data = JSON.parse(content);
      let changed = false;
      if (!data.products) { data.products = []; changed = true; }
      if (!data.orders) { data.orders = []; changed = true; }
      if (!data.users) { data.users = []; changed = true; }
      if (!data.inquiries) { data.inquiries = []; changed = true; }
      if (!data.reviews) { data.reviews = []; changed = true; }
      if (!data.cart_activity) { data.cart_activity = []; changed = true; }
      if (!data.homepage_sections) { data.homepage_sections = []; changed = true; }
      if (changed) {
        fs.writeFileSync(jsonFilePath, JSON.stringify(data, null, 2), 'utf8');
      }
    } catch (e) {
      console.error("Error reading database.json, resetting file:", e.message);
      const defaultData = {
        products: [],
        orders: [],
        users: [],
        inquiries: [],
        reviews: [],
        cart_activity: [],
        homepage_sections: []
      };
      fs.writeFileSync(jsonFilePath, JSON.stringify(defaultData, null, 2), 'utf8');
    }
  }
}

function readJsonDb() {
  ensureJsonFile();
  return JSON.parse(fs.readFileSync(jsonFilePath, 'utf8'));
}

function writeJsonDb(data) {
  fs.writeFileSync(jsonFilePath, JSON.stringify(data, null, 2), 'utf8');
}

// Helper parsers for types
function parseProduct(row) {
  if (!row) return null;
  return {
    ...row,
    price: parseFloat(row.price),
    oldPrice: row.oldPrice ? parseFloat(row.oldPrice) : null,
    stock: parseInt(row.stock) || 0,
    featured: !!row.featured
  };
}

function parseOrder(row) {
  if (!row) return null;
  return {
    ...row,
    totalAmount: parseFloat(row.totalAmount)
  };
}

export async function initDb() {
  if (useLocalJson) {
    console.log("=== Using Local JSON Database Mode (Supabase not available) ===");
    ensureJsonFile();
    return;
  }

  console.log("[DATABASE] Initializing Supabase PostgreSQL tables...");
  try {
    // 1. Products Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS products (
        "id" VARCHAR(50) PRIMARY KEY,
        "createdAt" VARCHAR(50) NOT NULL,
        "featured" BOOLEAN DEFAULT FALSE,
        "sizes" TEXT[],
        "colors" TEXT[],
        "stock" INTEGER DEFAULT 20,
        "name" TEXT NOT NULL,
        "price" NUMERIC NOT NULL,
        "oldPrice" NUMERIC,
        "image" TEXT NOT NULL,
        "category" TEXT NOT NULL,
        "description" TEXT DEFAULT '',
        "colorImages" JSONB DEFAULT '{}'::jsonb,
        "additionalImages" TEXT[] DEFAULT '{}'::text[]
      )
    `);
    
    // 2. Orders Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS orders (
        "id" VARCHAR(50) PRIMARY KEY,
        "createdAt" VARCHAR(50) NOT NULL,
        "status" TEXT DEFAULT 'Pending',
        "paymentStatus" TEXT DEFAULT 'Pending',
        "paymentMethod" TEXT DEFAULT 'COD',
        "paymentDetails" JSONB DEFAULT '{}'::jsonb,
        "customerName" TEXT NOT NULL,
        "email" TEXT NOT NULL,
        "address" TEXT NOT NULL,
        "phone" TEXT DEFAULT '',
        "items" JSONB NOT NULL,
        "totalAmount" NUMERIC NOT NULL
      )
    `);

    // Gracefully check and add columns if orders table existed before
    try {
      await pool.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS "paymentMethod" TEXT DEFAULT \'COD\'');
      await pool.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS "paymentDetails" JSONB DEFAULT \'{}\'::jsonb');
    } catch (e) {
      console.warn("Alter table orders warning:", e.message);
    }
    
    // 3. Users Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        "id" VARCHAR(50) PRIMARY KEY,
        "createdAt" VARCHAR(50) NOT NULL,
        "name" TEXT DEFAULT '',
        "email" TEXT NOT NULL,
        "phone" TEXT NOT NULL,
        "address" TEXT DEFAULT ''
      )
    `);
    
    // 4. Inquiries Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS inquiries (
        "id" VARCHAR(50) PRIMARY KEY,
        "createdAt" VARCHAR(50) NOT NULL,
        "name" TEXT NOT NULL,
        "email" TEXT NOT NULL,
        "phone" TEXT DEFAULT '',
        "subject" TEXT DEFAULT 'General Inquiry',
        "message" TEXT NOT NULL
      )
    `);
    
    // 5. Reviews Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS reviews (
        "id" VARCHAR(50) PRIMARY KEY,
        "productId" VARCHAR(50) NOT NULL,
        "author" TEXT NOT NULL,
        "rating" INTEGER NOT NULL,
        "comment" TEXT NOT NULL,
        "createdAt" VARCHAR(50) NOT NULL
      )
    `);

    // 6. Store Config Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS store_config (
        "key" VARCHAR(50) PRIMARY KEY,
        "value" JSONB NOT NULL
      )
    `);
    
    console.log("=== Supabase PostgreSQL Tables Connected & Verified ===");
  } catch (err) {
    console.error("Supabase PostgreSQL table initialization failed. Falling back to Local JSON database mode! Error:", err.message);
    useLocalJson = true;
    ensureJsonFile();
  }
}

// --- PRODUCTS CRUD ---
export async function getProducts() {
  if (useLocalJson) {
    const db = readJsonDb();
    return db.products.map(parseProduct);
  }
  try {
    const res = await pool.query('SELECT * FROM products ORDER BY "createdAt" DESC');
    return res.rows.map(parseProduct);
  } catch (err) {
    console.error("Postgres getProducts error:", err);
    return [];
  }
}

export async function addProduct(product) {
  const newId = Date.now().toString();
  const newProductObj = {
    id: newId,
    createdAt: new Date().toISOString(),
    featured: !!product.featured,
    sizes: product.sizes || ["S", "M", "L", "XL"],
    colors: product.colors || ["Default"],
    stock: product.stock !== undefined ? parseInt(product.stock) : 20,
    name: product.name,
    price: parseFloat(product.price),
    oldPrice: product.oldPrice ? parseFloat(product.oldPrice) : null,
    image: product.image || 'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=500&auto=format&fit=crop',
    category: product.category,
    description: product.description || '',
    colorImages: product.colorImages || {},
    additionalImages: product.additionalImages || []
  };

  if (useLocalJson) {
    const db = readJsonDb();
    db.products.unshift(newProductObj);
    writeJsonDb(db);
    return newProductObj;
  }

  try {
    await pool.query(
      `INSERT INTO products ("id", "createdAt", "featured", "sizes", "colors", "stock", "name", "price", "oldPrice", "image", "category", "description", "colorImages", "additionalImages")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        newProductObj.id,
        newProductObj.createdAt,
        newProductObj.featured,
        newProductObj.sizes,
        newProductObj.colors,
        newProductObj.stock,
        newProductObj.name,
        newProductObj.price,
        newProductObj.oldPrice,
        newProductObj.image,
        newProductObj.category,
        newProductObj.description,
        JSON.stringify(newProductObj.colorImages),
        newProductObj.additionalImages
      ]
    );
    return newProductObj;
  } catch (err) {
    console.error("Postgres addProduct error:", err);
    throw err;
  }
}

export async function updateProductStock(id, newStock) {
  const stockVal = Math.max(0, parseInt(newStock) || 0);
  if (useLocalJson) {
    const db = readJsonDb();
    const idx = db.products.findIndex(p => p.id === id);
    if (idx !== -1) {
      db.products[idx].stock = stockVal;
      writeJsonDb(db);
      return parseProduct(db.products[idx]);
    }
    return null;
  }
  try {
    const res = await pool.query(
      'UPDATE products SET "stock" = $1 WHERE "id" = $2 RETURNING *',
      [stockVal, id]
    );
    if (res.rows.length > 0) {
      return parseProduct(res.rows[0]);
    }
  } catch (err) {
    console.error("Postgres updateProductStock error:", err);
  }
  return null;
}

export async function updateProduct(id, fields) {
  if (useLocalJson) {
    const db = readJsonDb();
    const idx = db.products.findIndex(p => p.id === id);
    if (idx !== -1) {
      const updated = { ...db.products[idx] };
      for (const [key, val] of Object.entries(fields)) {
        if (val !== undefined) {
          if (key === 'price' || key === 'oldPrice') {
            updated[key] = val !== null ? parseFloat(val) : null;
          } else if (key === 'stock') {
            updated[key] = parseInt(val) || 0;
          } else {
            updated[key] = val;
          }
        }
      }
      db.products[idx] = updated;
      writeJsonDb(db);
      return parseProduct(updated);
    }
    return null;
  }

  const setClauses = [];
  const values = [];
  let paramIdx = 1;

  for (const [key, val] of Object.entries(fields)) {
    if (val !== undefined) {
      setClauses.push(`"${key}" = $${paramIdx}`);
      if (key === 'price' || key === 'oldPrice') {
        values.push(val !== null ? parseFloat(val) : null);
      } else if (key === 'stock') {
        values.push(parseInt(val) || 0);
      } else {
        values.push(val);
      }
      paramIdx++;
    }
  }

  if (setClauses.length === 0) return null;

  values.push(id);
  const query = `UPDATE products SET ${setClauses.join(', ')} WHERE "id" = $${paramIdx} RETURNING *`;
  
  try {
    const res = await pool.query(query, values);
    if (res.rows.length > 0) {
      return parseProduct(res.rows[0]);
    }
  } catch (err) {
    console.error("Postgres updateProduct error:", err);
  }
  return null;
}

export async function deleteProduct(id) {
  if (useLocalJson) {
    const db = readJsonDb();
    const idx = db.products.findIndex(p => p.id === id);
    if (idx !== -1) {
      const deletedProd = db.products[idx];
      db.products.splice(idx, 1);
      writeJsonDb(db);
      if (deletedProd.image && deletedProd.image.startsWith('/uploads/')) {
        const imgPath = path.join(__dirname, 'public', deletedProd.image);
        if (fs.existsSync(imgPath)) {
          try {
            fs.unlinkSync(imgPath);
          } catch (e) {
            console.error("Error deleting image file:", e);
          }
        }
      }
      return true;
    }
    return false;
  }

  try {
    const res = await pool.query('DELETE FROM products WHERE "id" = $1 RETURNING *', [id]);
    if (res.rows.length > 0) {
      const deletedProd = parseProduct(res.rows[0]);
      if (deletedProd.image && deletedProd.image.startsWith('/uploads/')) {
        const imgPath = path.join(__dirname, 'public', deletedProd.image);
        if (fs.existsSync(imgPath)) {
          try {
            fs.unlinkSync(imgPath);
          } catch (e) {
            console.error("Error deleting image file:", e);
          }
        }
      }
      return true;
    }
  } catch (err) {
    console.error("Postgres deleteProduct error:", err);
  }
  return false;
}

// --- USERS CRUD ---
export async function getUsers() {
  if (useLocalJson) {
    const db = readJsonDb();
    return db.users;
  }
  try {
    const res = await pool.query('SELECT * FROM users ORDER BY "createdAt" DESC');
    return res.rows;
  } catch (err) {
    console.error("Postgres getUsers error:", err);
    return [];
  }
}

export async function addUser(user) {
  if (useLocalJson) {
    const db = readJsonDb();
    let existingUser = db.users.find(u => u.phone === user.phone || u.email === user.email);
    if (existingUser) {
      existingUser.name = user.name || existingUser.name;
      existingUser.address = user.address || existingUser.address;
      existingUser.phone = user.phone || existingUser.phone;
      existingUser.email = user.email || existingUser.email;
      writeJsonDb(db);
      return existingUser;
    }

    const newId = 'USR-' + Math.floor(100000 + Math.random() * 900000);
    const newUserObj = {
      id: newId,
      createdAt: new Date().toISOString(),
      name: user.name || '',
      email: user.email || '',
      phone: user.phone || '',
      address: user.address || ''
    };

    db.users.unshift(newUserObj);
    writeJsonDb(db);
    return newUserObj;
  }

  try {
    let existingUser = null;
    const findRes = await pool.query(
      'SELECT * FROM users WHERE "phone" = $1 OR "email" = $2 LIMIT 1',
      [user.phone, user.email]
    );
    if (findRes.rows.length > 0) {
      existingUser = findRes.rows[0];
    }

    if (existingUser) {
      const updatedFields = {
        name: user.name || existingUser.name,
        address: user.address || existingUser.address,
        phone: user.phone || existingUser.phone,
        email: user.email || existingUser.email
      };
      const res = await pool.query(
        'UPDATE users SET "name" = $1, "address" = $2, "phone" = $3, "email" = $4 WHERE "id" = $5 RETURNING *',
        [updatedFields.name, updatedFields.address, updatedFields.phone, updatedFields.email, existingUser.id]
      );
      if (res.rows.length > 0) {
        return res.rows[0];
      }
    }

    const newId = 'USR-' + Math.floor(100000 + Math.random() * 900000);
    const newUserObj = {
      id: newId,
      createdAt: new Date().toISOString(),
      name: user.name || '',
      email: user.email || '',
      phone: user.phone || '',
      address: user.address || ''
    };

    await pool.query(
      'INSERT INTO users ("id", "createdAt", "name", "email", "phone", "address") VALUES ($1, $2, $3, $4, $5, $6)',
      [newUserObj.id, newUserObj.createdAt, newUserObj.name, newUserObj.email, newUserObj.phone, newUserObj.address]
    );
    return newUserObj;
  } catch (err) {
    console.error("Postgres addUser error:", err);
    throw err;
  }
}

// --- ORDERS CRUD ---
export async function getOrders() {
  if (useLocalJson) {
    const db = readJsonDb();
    return db.orders.map(parseOrder);
  }
  try {
    const res = await pool.query('SELECT * FROM orders ORDER BY "createdAt" DESC');
    return res.rows.map(parseOrder);
  } catch (err) {
    console.error("Postgres getOrders error:", err);
    return [];
  }
}

export async function addOrder(order) {
  const newId = 'ORD-' + Math.floor(100000 + Math.random() * 900000);
  const newOrderObj = {
    id: newId,
    createdAt: new Date().toISOString(),
    status: 'Pending',
    paymentStatus: order.paymentStatus || 'Pending',
    paymentMethod: order.paymentMethod || 'COD',
    paymentDetails: order.paymentDetails || {},
    customerName: order.customerName,
    email: order.email,
    address: order.address,
    phone: order.phone || '',
    items: order.items || [],
    totalAmount: parseFloat(order.totalAmount)
  };

  if (useLocalJson) {
    const db = readJsonDb();
    
    // Decrement stock in json
    if (order.items && Array.isArray(order.items)) {
      for (const item of order.items) {
        const prod = db.products.find(p => p.id === item.id);
        if (prod) {
          const currentStock = prod.stock !== undefined ? prod.stock : 20;
          prod.stock = Math.max(0, currentStock - (parseInt(item.quantity) || 0));
        }
      }
    }
    
    db.orders.unshift(newOrderObj);
    writeJsonDb(db);
    
    // Add/Update user
    if (order.customerName && (order.phone || order.email)) {
      await addUser({
        name: order.customerName,
        email: order.email,
        phone: order.phone,
        address: order.address
      });
    }
    return newOrderObj;
  }

  if (order.customerName && (order.phone || order.email)) {
    await addUser({
      name: order.customerName,
      email: order.email,
      phone: order.phone,
      address: order.address
    });
  }

  if (order.items && Array.isArray(order.items)) {
    for (const item of order.items) {
      try {
        const prodRes = await pool.query('SELECT "stock" FROM products WHERE "id" = $1 LIMIT 1', [item.id]);
        if (prodRes.rows.length > 0) {
          const currentStock = prodRes.rows[0].stock !== undefined ? prodRes.rows[0].stock : 20;
          await pool.query('UPDATE products SET "stock" = $1 WHERE "id" = $2', [Math.max(0, currentStock - (parseInt(item.quantity) || 0)), item.id]);
        }
      } catch (err) {
        console.error("Postgres decrement stock error:", err);
      }
    }
  }

  try {
    await pool.query(
      `INSERT INTO orders ("id", "createdAt", "status", "paymentStatus", "paymentMethod", "paymentDetails", "customerName", "email", "address", "phone", "items", "totalAmount")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        newOrderObj.id,
        newOrderObj.createdAt,
        newOrderObj.status,
        newOrderObj.paymentStatus,
        newOrderObj.paymentMethod,
        JSON.stringify(newOrderObj.paymentDetails),
        newOrderObj.customerName,
        newOrderObj.email,
        newOrderObj.address,
        newOrderObj.phone,
        JSON.stringify(newOrderObj.items),
        newOrderObj.totalAmount
      ]
    );
    return newOrderObj;
  } catch (err) {
    console.error("Postgres addOrder error:", err);
    throw err;
  }
}

export async function updateOrderStatus(id, status) {
  if (useLocalJson) {
    const db = readJsonDb();
    const idx = db.orders.findIndex(o => o.id === id);
    if (idx !== -1) {
      db.orders[idx].status = status;
      writeJsonDb(db);
      return parseOrder(db.orders[idx]);
    }
    return null;
  }
  try {
    const res = await pool.query(
      'UPDATE orders SET "status" = $1 WHERE "id" = $2 RETURNING *',
      [status, id]
    );
    if (res.rows.length > 0) {
      return parseOrder(res.rows[0]);
    }
  } catch (err) {
    console.error("Postgres updateOrderStatus error:", err);
  }
  return null;
}

export async function updateOrderPaymentStatus(id, paymentStatus) {
  if (useLocalJson) {
    const db = readJsonDb();
    const idx = db.orders.findIndex(o => o.id === id);
    if (idx !== -1) {
      db.orders[idx].paymentStatus = paymentStatus;
      writeJsonDb(db);
      return parseOrder(db.orders[idx]);
    }
    return null;
  }
  try {
    const res = await pool.query(
      'UPDATE orders SET "paymentStatus" = $1 WHERE "id" = $2 RETURNING *',
      [paymentStatus, id]
    );
    if (res.rows.length > 0) {
      return parseOrder(res.rows[0]);
    }
  } catch (err) {
    console.error("Postgres updateOrderPaymentStatus error:", err);
  }
  return null;
}

export async function deleteOrder(id) {
  if (useLocalJson) {
    const db = readJsonDb();
    const idx = db.orders.findIndex(o => o.id === id);
    if (idx !== -1) {
      db.orders.splice(idx, 1);
      writeJsonDb(db);
      return true;
    }
    return false;
  }
  try {
    const res = await pool.query('DELETE FROM orders WHERE "id" = $1', [id]);
    return res.rowCount > 0;
  } catch (err) {
    console.error("Postgres deleteOrder error:", err);
    return false;
  }
}

// --- INQUIRIES CRUD ---
export async function getInquiries() {
  if (useLocalJson) {
    const db = readJsonDb();
    return db.inquiries || [];
  }
  try {
    const res = await pool.query('SELECT * FROM inquiries ORDER BY "createdAt" DESC');
    return res.rows;
  } catch (err) {
    console.error("Postgres getInquiries error:", err);
    return [];
  }
}

export async function addInquiry(inquiry) {
  const newId = 'INQ-' + Math.floor(100000 + Math.random() * 900000);
  const newInquiryObj = {
    id: newId,
    createdAt: new Date().toISOString(),
    name: inquiry.name,
    email: inquiry.email,
    phone: inquiry.phone || '',
    subject: inquiry.subject || 'General Inquiry',
    message: inquiry.message
  };

  if (useLocalJson) {
    const db = readJsonDb();
    if (!db.inquiries) db.inquiries = [];
    db.inquiries.unshift(newInquiryObj);
    writeJsonDb(db);
    return newInquiryObj;
  }

  try {
    await pool.query(
      'INSERT INTO inquiries ("id", "createdAt", "name", "email", "phone", "subject", "message") VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [newInquiryObj.id, newInquiryObj.createdAt, newInquiryObj.name, newInquiryObj.email, newInquiryObj.phone, newInquiryObj.subject, newInquiryObj.message]
    );
    return newInquiryObj;
  } catch (err) {
    console.error("Postgres addInquiry error:", err);
    throw err;
  }
}

export async function deleteInquiry(id) {
  if (useLocalJson) {
    const db = readJsonDb();
    if (!db.inquiries) db.inquiries = [];
    const idx = db.inquiries.findIndex(i => i.id === id);
    if (idx !== -1) {
      db.inquiries.splice(idx, 1);
      writeJsonDb(db);
      return true;
    }
    return false;
  }
  try {
    const res = await pool.query('DELETE FROM inquiries WHERE "id" = $1', [id]);
    return res.rowCount > 0;
  } catch (err) {
    console.error("Postgres deleteInquiry error:", err);
    return false;
  }
}

// --- TELEGRAM BOT STUBS / AUTHENTICATION ---
export function getAuthorizedUsers() { return []; }
export function authorizeUser() { return false; }
export async function syncPostgresAdmins() {}

export async function resetDatabase() {
  if (useLocalJson) {
    const db = readJsonDb();
    db.products = [];
    db.orders = [];
    db.users = [];
    db.inquiries = [];
    db.reviews = [];
    db.cart_activity = [];
    db.homepage_sections = [];
    writeJsonDb(db);
    return;
  }
  try {
    await pool.query('TRUNCATE TABLE products, orders, users, inquiries, reviews, store_config, cart_activity CASCADE');
    console.log("[DATABASE] Supabase PostgreSQL database reset successfully.");
  } catch (err) {
    console.error("Error resetting Postgres database:", err);
    throw err;
  }
}

// --- REVIEWS CRUD ---
export async function getReviews(productId) {
  if (useLocalJson) {
    const db = readJsonDb();
    if (!db.reviews) db.reviews = [];
    return db.reviews.filter(r => r.productId === productId);
  }
  try {
    const res = await pool.query('SELECT * FROM reviews WHERE "productId" = $1 ORDER BY "createdAt" DESC', [productId]);
    return res.rows;
  } catch (err) {
    console.error("Postgres getReviews error:", err);
    return [];
  }
}

export async function addReview(productId, review) {
  const newId = Date.now().toString();
  const newReview = {
    id: newId,
    productId,
    author: review.author,
    rating: parseInt(review.rating) || 5,
    comment: review.comment,
    createdAt: new Date().toISOString()
  };

  if (useLocalJson) {
    const db = readJsonDb();
    if (!db.reviews) db.reviews = [];
    db.reviews.unshift(newReview);
    writeJsonDb(db);
    return newReview;
  }

  try {
    await pool.query(
      'INSERT INTO reviews ("id", "productId", "author", "rating", "comment", "createdAt") VALUES ($1, $2, $3, $4, $5, $6)',
      [newReview.id, newReview.productId, newReview.author, newReview.rating, newReview.comment, newReview.createdAt]
    );
    return newReview;
  } catch (err) {
    console.error("Postgres addReview error:", err);
    throw err;
  }
}

// --- CART ACTIVITY CRUD ---
export async function getCartActivity() {
  if (useLocalJson) {
    const db = readJsonDb();
    return db.cart_activity || [];
  }
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS cart_activity (
        "id" VARCHAR(50) PRIMARY KEY,
        "createdAt" VARCHAR(50) NOT NULL,
        "email" TEXT NOT NULL,
        "phone" TEXT DEFAULT '',
        "name" TEXT DEFAULT '',
        "productId" TEXT NOT NULL,
        "productName" TEXT NOT NULL,
        "quantity" INTEGER DEFAULT 1
      )
    `);
    const res = await pool.query('SELECT * FROM cart_activity ORDER BY "createdAt" DESC LIMIT 100');
    return res.rows;
  } catch (err) {
    console.error("Postgres getCartActivity error:", err);
    return [];
  }
}

export async function addCartActivity(act) {
  const newId = 'ACT-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
  const newActObj = {
    id: newId,
    createdAt: new Date().toISOString(),
    email: act.email || 'Guest',
    phone: act.phone || '',
    name: act.name || 'Guest User',
    productId: act.productId,
    productName: act.productName,
    quantity: act.quantity !== undefined ? parseInt(act.quantity) : 1
  };

  if (useLocalJson) {
    const db = readJsonDb();
    if (!db.cart_activity) db.cart_activity = [];
    db.cart_activity.unshift(newActObj);
    if (db.cart_activity.length > 100) {
      db.cart_activity = db.cart_activity.slice(0, 100);
    }
    writeJsonDb(db);
    return newActObj;
  }

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS cart_activity (
        "id" VARCHAR(50) PRIMARY KEY,
        "createdAt" VARCHAR(50) NOT NULL,
        "email" TEXT NOT NULL,
        "phone" TEXT DEFAULT '',
        "name" TEXT DEFAULT '',
        "productId" TEXT NOT NULL,
        "productName" TEXT NOT NULL,
        "quantity" INTEGER DEFAULT 1
      )
    `);
    await pool.query(
      'INSERT INTO cart_activity ("id", "createdAt", "email", "phone", "name", "productId", "productName", "quantity") VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [newActObj.id, newActObj.createdAt, newActObj.email, newActObj.phone, newActObj.name, newActObj.productId, newActObj.productName, newActObj.quantity]
    );
    return newActObj;
  } catch (err) {
    console.error("Postgres addCartActivity error:", err);
    throw err;
  }
}

// --- HOMEPAGE SECTIONS ---
export async function getHomepageSections() {
  if (useLocalJson) {
    const db = readJsonDb();
    if (db.homepage_sections && db.homepage_sections.length > 0) {
      return db.homepage_sections;
    }
    return [
      { id: 'recommendations', title: 'Mostly Searched & Popular', category: 'recommendations', enabled: true },
      { id: 'collections', title: 'Shop By Collections', category: 'collections', enabled: true },
      { id: 'new-arrivals', title: 'New Arrivals', category: 'newarrivals', enabled: true },
      { id: 'kurtis', title: 'Kurtis', category: 'Kurtis', enabled: true },
      { id: 'nightgown', title: 'Night Gown', category: 'Nightgown', enabled: true },
      { id: 'kids', title: 'Kids Collections', category: 'Kids', enabled: true },
      { id: 'shorttops', title: 'Short Tops', category: 'Short Tops', enabled: true },
      { id: 'sarees', title: 'Sarees', category: 'Sarees', enabled: true },
      { id: 'jewellery', title: 'Jewellery Collections', category: 'Jewellery', enabled: true }
    ];
  }
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS store_config (
        "key" VARCHAR(50) PRIMARY KEY,
        "value" JSONB NOT NULL
      )
    `);
    const res = await pool.query('SELECT "value" FROM store_config WHERE "key" = $1 LIMIT 1', ['homepage_sections']);
    if (res.rows.length > 0) {
      return res.rows[0].value;
    }
  } catch (err) {
    console.error("Postgres getHomepageSections error:", err);
  }
  
  return [
    { id: 'recommendations', title: 'Mostly Searched & Popular', category: 'recommendations', enabled: true },
    { id: 'collections', title: 'Shop By Collections', category: 'collections', enabled: true },
    { id: 'new-arrivals', title: 'New Arrivals', category: 'newarrivals', enabled: true },
    { id: 'kurtis', title: 'Kurtis', category: 'Kurtis', enabled: true },
    { id: 'nightgown', title: 'Night Gown', category: 'Nightgown', enabled: true },
    { id: 'kids', title: 'Kids Collections', category: 'Kids', enabled: true },
    { id: 'shorttops', title: 'Short Tops', category: 'Short Tops', enabled: true },
    { id: 'sarees', title: 'Sarees', category: 'Sarees', enabled: true },
    { id: 'jewellery', title: 'Jewellery Collections', category: 'Jewellery', enabled: true }
  ];
}

export async function saveHomepageSections(sections) {
  if (useLocalJson) {
    const db = readJsonDb();
    db.homepage_sections = sections;
    writeJsonDb(db);
    return;
  }
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS store_config (
        "key" VARCHAR(50) PRIMARY KEY,
        "value" JSONB NOT NULL
      )
    `);
    await pool.query(`
      INSERT INTO store_config ("key", "value")
      VALUES ($1, $2)
      ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED.value
    `, ['homepage_sections', JSON.stringify(sections)]);
  } catch (err) {
    console.error("Postgres saveHomepageSections error:", err);
    throw err;
  }
}
