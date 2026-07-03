import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_FILE = path.join(__dirname, 'database.json');

// --- POSTGRES CONNECTION ---
let pool = null;
let isPostgresConnected = false;
const PG_CONNECTION_STRING = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;

if (PG_CONNECTION_STRING) {
  console.log("[DATABASE] Connecting to cloud Supabase PostgreSQL...");
  const useSsl = !PG_CONNECTION_STRING.includes('localhost') && !PG_CONNECTION_STRING.includes('127.0.0.1');
  pool = new Pool({
    connectionString: PG_CONNECTION_STRING,
    ssl: useSsl ? { rejectUnauthorized: false } : false
  });
  
  // Test connection
  pool.query('SELECT NOW()')
    .then(async () => {
      isPostgresConnected = true;
      console.log("=== Cloud Supabase PostgreSQL Connected Successfully ===");
      await initPostgresTables();
      await syncPostgresAdmins();
    })
    .catch(err => {
      console.error("!!! Supabase PostgreSQL Connection Error, falling back to local JSON database !!!", err);
    });
} else {
  console.log("[DATABASE] No SUPABASE_DB_URL found in .env. Running on local JSON file database.");
}

// --- INITIALIZE TABLES ---
async function initPostgresTables() {
  if (!isPostgresConnected) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // 1. Products Table
    await client.query(`
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
    await client.query(`
      CREATE TABLE IF NOT EXISTS orders (
        "id" VARCHAR(50) PRIMARY KEY,
        "createdAt" VARCHAR(50) NOT NULL,
        "status" TEXT DEFAULT 'Pending',
        "paymentStatus" TEXT DEFAULT 'Pending',
        "customerName" TEXT NOT NULL,
        "email" TEXT NOT NULL,
        "address" TEXT NOT NULL,
        "phone" TEXT DEFAULT '',
        "items" JSONB NOT NULL,
        "totalAmount" NUMERIC NOT NULL
      )
    `);
    
    // 3. Users Table
    await client.query(`
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
    await client.query(`
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
    
    // 5. Admins Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS admins (
        "chatId" BIGINT PRIMARY KEY,
        "createdAt" VARCHAR(50) NOT NULL
      )
    `);
    
    // 6. Reviews Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS reviews (
        "id" VARCHAR(50) PRIMARY KEY,
        "productId" VARCHAR(50) NOT NULL,
        "author" TEXT NOT NULL,
        "rating" INTEGER NOT NULL,
        "comment" TEXT NOT NULL,
        "createdAt" VARCHAR(50) NOT NULL
      )
    `);
    
    await client.query('COMMIT');
    console.log("[DATABASE] PostgreSQL tables verified/created successfully.");
  } catch (error) {
    await client.query('ROLLBACK');
    console.error("[DATABASE] Error initializing PostgreSQL tables:", error);
  } finally {
    client.release();
  }
}

// --- PARSE DATATYPES FOR APP COMPATIBILITY ---
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

// --- LOCAL JSON DATABASE CONFIG (FALLBACK) ---
const defaultProducts = [];

export function initDb() {
  if (!isPostgresConnected) {
    if (!fs.existsSync(DB_FILE)) {
      const data = {
        products: defaultProducts,
        orders: [],
        users: [],
        inquiries: [],
        admins: []
      };
      fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
      console.log("Local database initialized with sample data.");
    }
  }
  
  // Ensure upload directory exists
  const uploadDir = path.join(__dirname, 'public', 'uploads');
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
    console.log("Uploads directory created.");
  }
}

export function getData() {
  initDb();
  const rawData = fs.readFileSync(DB_FILE, 'utf8');
  return JSON.parse(rawData);
}

export function saveData(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// --- PRODUCTS CRUD ---
export async function getProducts() {
  if (isPostgresConnected) {
    try {
      const res = await pool.query('SELECT * FROM products ORDER BY "createdAt" DESC');
      return res.rows.map(parseProduct);
    } catch (err) {
      console.error("Postgres getProducts error:", err);
    }
  }
  return getData().products;
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

  if (isPostgresConnected) {
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
          newProductObj.colorImages,
          newProductObj.additionalImages
        ]
      );
      return newProductObj;
    } catch (err) {
      console.error("Postgres addProduct error:", err);
    }
  }

  const data = getData();
  data.products.unshift(newProductObj);
  saveData(data);
  return newProductObj;
}

export async function updateProductStock(id, newStock) {
  const stockVal = Math.max(0, parseInt(newStock) || 0);
  if (isPostgresConnected) {
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
  }
  
  const data = getData();
  const index = data.products.findIndex(p => p.id === id);
  if (index !== -1) {
    data.products[index].stock = stockVal;
    saveData(data);
    return data.products[index];
  }
  return null;
}

export async function deleteProduct(id) {
  let deletedProd = null;
  if (isPostgresConnected) {
    try {
      const res = await pool.query('DELETE FROM products WHERE "id" = $1 RETURNING *', [id]);
      if (res.rows.length > 0) {
        deletedProd = parseProduct(res.rows[0]);
      }
    } catch (err) {
      console.error("Postgres deleteProduct error:", err);
    }
  } else {
    const data = getData();
    const index = data.products.findIndex(p => p.id === id);
    if (index !== -1) {
      deletedProd = data.products.splice(index, 1)[0];
      saveData(data);
    }
  }

  if (deletedProd) {
    // Clean up local image file if it exists and isn't a sample image
    if (deletedProd.image && deletedProd.image.startsWith('/uploads/') && !deletedProd.image.includes('aether') && !deletedProd.image.includes('trench') && !deletedProd.image.includes('silk') && !deletedProd.image.includes('knit')) {
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

// --- USERS CRUD ---
export async function getUsers() {
  if (isPostgresConnected) {
    try {
      const res = await pool.query('SELECT * FROM users ORDER BY "createdAt" DESC');
      return res.rows;
    } catch (err) {
      console.error("Postgres getUsers error:", err);
    }
  }
  const data = getData();
  if (!data.users) data.users = [];
  return data.users;
}

export async function addUser(user) {
  let existingUser = null;
  if (isPostgresConnected) {
    try {
      const res = await pool.query(
        'SELECT * FROM users WHERE "phone" = $1 OR "email" = $2 LIMIT 1',
        [user.phone, user.email]
      );
      if (res.rows.length > 0) {
        existingUser = res.rows[0];
      }
    } catch (err) {
      console.error("Postgres find user error:", err);
    }
  } else {
    const data = getData();
    if (!data.users) data.users = [];
    existingUser = data.users.find(u => u.phone === user.phone || u.email === user.email);
  }

  if (existingUser) {
    const updatedFields = {
      name: user.name || existingUser.name,
      address: user.address || existingUser.address,
      phone: user.phone || existingUser.phone,
      email: user.email || existingUser.email
    };
    if (isPostgresConnected) {
      try {
        const res = await pool.query(
          'UPDATE users SET "name" = $1, "address" = $2, "phone" = $3, "email" = $4 WHERE "id" = $5 RETURNING *',
          [updatedFields.name, updatedFields.address, updatedFields.phone, updatedFields.email, existingUser.id]
        );
        if (res.rows.length > 0) {
          return res.rows[0];
        }
      } catch (err) {
        console.error("Postgres updateUser error:", err);
      }
    } else {
      const data = getData();
      const idx = data.users.findIndex(u => u.id === existingUser.id);
      if (idx !== -1) {
        data.users[idx] = { ...data.users[idx], ...updatedFields };
        saveData(data);
        return data.users[idx];
      }
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

  if (isPostgresConnected) {
    try {
      await pool.query(
        'INSERT INTO users ("id", "createdAt", "name", "email", "phone", "address") VALUES ($1, $2, $3, $4, $5, $6)',
        [newUserObj.id, newUserObj.createdAt, newUserObj.name, newUserObj.email, newUserObj.phone, newUserObj.address]
      );
      return newUserObj;
    } catch (err) {
      console.error("Postgres addUser error:", err);
    }
  }

  const data = getData();
  if (!data.users) data.users = [];
  data.users.push(newUserObj);
  saveData(data);
  return newUserObj;
}

// --- ORDERS CRUD ---
export async function getOrders() {
  if (isPostgresConnected) {
    try {
      const res = await pool.query('SELECT * FROM orders ORDER BY "createdAt" DESC');
      return res.rows.map(parseOrder);
    } catch (err) {
      console.error("Postgres getOrders error:", err);
    }
  }
  return getData().orders;
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
      if (isPostgresConnected) {
        try {
          const prodRes = await pool.query('SELECT "stock" FROM products WHERE "id" = $1 LIMIT 1', [item.id]);
          if (prodRes.rows.length > 0) {
            const currentStock = prodRes.rows[0].stock !== undefined ? prodRes.rows[0].stock : 20;
            await pool.query('UPDATE products SET "stock" = $1 WHERE "id" = $2', [Math.max(0, currentStock - (parseInt(item.quantity) || 0)), item.id]);
          }
        } catch (err) {
          console.error("Postgres decrement stock error:", err);
        }
      } else {
        const data = getData();
        const pIdx = data.products.findIndex(p => p.id === item.id);
        if (pIdx !== -1) {
          const currentStock = data.products[pIdx].stock !== undefined ? data.products[pIdx].stock : 20;
          data.products[pIdx].stock = Math.max(0, currentStock - (parseInt(item.quantity) || 0));
          saveData(data);
        }
      }
    }
  }

  if (isPostgresConnected) {
    try {
      await pool.query(
        `INSERT INTO orders ("id", "createdAt", "status", "paymentStatus", "customerName", "email", "address", "phone", "items", "totalAmount")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          newOrderObj.id,
          newOrderObj.createdAt,
          newOrderObj.status,
          newOrderObj.paymentStatus,
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
    }
  }

  const data = getData();
  data.orders.unshift(newOrderObj);
  saveData(data);
  return newOrderObj;
}

export async function updateOrderStatus(id, status) {
  if (isPostgresConnected) {
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
  }
  
  const data = getData();
  const index = data.orders.findIndex(o => o.id === id);
  if (index !== -1) {
    data.orders[index].status = status;
    saveData(data);
    return data.orders[index];
  }
  return null;
}

export async function updateOrderPaymentStatus(id, paymentStatus) {
  if (isPostgresConnected) {
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
  }
  
  const data = getData();
  const index = data.orders.findIndex(o => o.id === id);
  if (index !== -1) {
    data.orders[index].paymentStatus = paymentStatus;
    saveData(data);
    return data.orders[index];
  }
  return null;
}

export async function deleteOrder(id) {
  if (isPostgresConnected) {
    try {
      const res = await pool.query('DELETE FROM orders WHERE "id" = $1', [id]);
      return res.rowCount > 0;
    } catch (err) {
      console.error("Postgres deleteOrder error:", err);
    }
  }
  
  const data = getData();
  const index = data.orders.findIndex(o => o.id === id);
  if (index !== -1) {
    data.orders.splice(index, 1);
    saveData(data);
    return true;
  }
  return false;
}

// --- INQUIRIES CRUD ---
export async function getInquiries() {
  if (isPostgresConnected) {
    try {
      const res = await pool.query('SELECT * FROM inquiries ORDER BY "createdAt" DESC');
      return res.rows;
    } catch (err) {
      console.error("Postgres getInquiries error:", err);
    }
  }
  const data = getData();
  if (!data.inquiries) data.inquiries = [];
  return data.inquiries;
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

  if (isPostgresConnected) {
    try {
      await pool.query(
        'INSERT INTO inquiries ("id", "createdAt", "name", "email", "phone", "subject", "message") VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [newInquiryObj.id, newInquiryObj.createdAt, newInquiryObj.name, newInquiryObj.email, newInquiryObj.phone, newInquiryObj.subject, newInquiryObj.message]
      );
      return newInquiryObj;
    } catch (err) {
      console.error("Postgres addInquiry error:", err);
    }
  }

  const data = getData();
  if (!data.inquiries) data.inquiries = [];
  data.inquiries.push(newInquiryObj);
  saveData(data);
  return newInquiryObj;
}

export async function deleteInquiry(id) {
  if (isPostgresConnected) {
    try {
      const res = await pool.query('DELETE FROM inquiries WHERE "id" = $1', [id]);
      return res.rowCount > 0;
    } catch (err) {
      console.error("Postgres deleteInquiry error:", err);
    }
  }
  
  const data = getData();
  if (!data.inquiries) return false;
  const index = data.inquiries.findIndex(i => i.id === id);
  if (index !== -1) {
    data.inquiries.splice(index, 1);
    saveData(data);
    return true;
  }
  return false;
}

// --- TELEGRAM BOT AUTHORIZATION ---
export function getAuthorizedUsers() {
  if (isPostgresConnected) {
    return global.authorizedAdminsCache || [];
  }
  const data = getData();
  if (!data.admins) data.admins = [];
  return data.admins;
}

export function authorizeUser(chatId) {
  const chatIdNum = parseInt(chatId);
  if (isNaN(chatIdNum)) return false;

  if (isPostgresConnected) {
    if (!global.authorizedAdminsCache) global.authorizedAdminsCache = [];
    if (global.authorizedAdminsCache.includes(chatIdNum)) return false;
    
    // Save to database
    pool.query('SELECT * FROM admins WHERE "chatId" = $1 LIMIT 1', [chatIdNum])
      .then(res => {
        if (res.rows.length === 0) {
          pool.query('INSERT INTO admins ("chatId", "createdAt") VALUES ($1, $2)', [chatIdNum, new Date().toISOString()])
            .then(() => {
              if (!global.authorizedAdminsCache.includes(chatIdNum)) {
                global.authorizedAdminsCache.push(chatIdNum);
              }
            });
        }
      })
      .catch(err => console.error("Error saving admin to PostgreSQL:", err));

    global.authorizedAdminsCache.push(chatIdNum);
    return true;
  }
  
  const data = getData();
  if (!data.admins) data.admins = [];
  if (data.admins.includes(chatIdNum)) return false;
  data.admins.push(chatIdNum);
  saveData(data);
  return true;
}

export async function syncPostgresAdmins() {
  if (isPostgresConnected) {
    try {
      const res = await pool.query('SELECT "chatId" FROM admins');
      global.authorizedAdminsCache = res.rows.map(a => parseInt(a.chatId));
      console.log(`[DATABASE] Loaded ${global.authorizedAdminsCache.length} authorized Telegram admins from PostgreSQL.`);
    } catch (e) {
      console.error("Error syncing Telegram admins from PostgreSQL:", e);
      global.authorizedAdminsCache = [];
    }
  }
}

export async function resetDatabase() {
  if (isPostgresConnected) {
    try {
      await pool.query('TRUNCATE TABLE products, orders, users, inquiries, admins, reviews CASCADE');
      global.authorizedAdminsCache = [];
      console.log("[DATABASE] Supabase PostgreSQL database reset successfully.");
    } catch (e) {
      console.error("Error resetting PostgreSQL database:", e);
      throw e;
    }
  } else {
    const data = {
      products: [],
      orders: [],
      users: [],
      inquiries: [],
      admins: [],
      reviews: []
    };
    saveData(data);
  }
}

export async function getReviews(productId) {
  if (isPostgresConnected) {
    try {
      const res = await pool.query('SELECT * FROM reviews WHERE "productId" = $1 ORDER BY "createdAt" DESC', [productId]);
      return res.rows;
    } catch (err) {
      console.error("Postgres getReviews error:", err);
    }
  }
  const data = getData();
  const reviews = data.reviews || [];
  return reviews.filter(r => r.productId === productId);
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
  
  if (isPostgresConnected) {
    try {
      await pool.query(
        'INSERT INTO reviews ("id", "productId", "author", "rating", "comment", "createdAt") VALUES ($1, $2, $3, $4, $5, $6)',
        [newReview.id, newReview.productId, newReview.author, newReview.rating, newReview.comment, newReview.createdAt]
      );
      return newReview;
    } catch (err) {
      console.error("Postgres addReview error:", err);
    }
  }
  
  const data = getData();
  if (!data.reviews) data.reviews = [];
  data.reviews.push(newReview);
  saveData(data);
  return newReview;
}

// --- CART ACTIVITY CRUD ---
export async function getCartActivity() {
  if (isPostgresConnected) {
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
    }
  }
  const data = getData();
  return data.cartActivity || [];
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

  if (isPostgresConnected) {
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
    }
  }

  const data = getData();
  if (!data.cartActivity) data.cartActivity = [];
  data.cartActivity.unshift(newActObj);
  if (data.cartActivity.length > 100) {
    data.cartActivity = data.cartActivity.slice(0, 100);
  }
  saveData(data);
  return newActObj;
}

export function getHomepageSections() {
  const data = getData();
  if (!data.homepageSections || data.homepageSections.length === 0) {
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
  return data.homepageSections;
}

export function saveHomepageSections(sections) {
  const data = getData();
  data.homepageSections = sections;
  saveData(data);
}

