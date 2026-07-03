import TelegramBot from 'node-telegram-bot-api';
import path from 'path';
import fs from 'fs';
import https from 'https';
import { fileURLToPath } from 'url';
import { addProduct, getProducts, deleteProduct, getOrders, getAuthorizedUsers, authorizeUser } from './db.js';
import { uploadLocalFileToCloudinary } from './cloudinary.js';
import { uploadToFirebaseStorage } from './firebase.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const token = process.env.TELEGRAM_BOT_TOKEN;
let bot = null;

// Session state to track multi-step /addproduct conversations
// format: { chatId: { step: 0, name: '', description: '', price: '', category: '', image: '' } }
const addProductSessions = {};

export function initBot() {
  if (!token || token === 'YOUR_TELEGRAM_BOT_TOKEN' || token.trim() === '') {
    console.log('[BOT] WARNING: TELEGRAM_BOT_TOKEN not configured in .env. Bot features disabled.');
    return;
  }

  // Initialize bot in long-polling mode
  bot = new TelegramBot(token, { polling: true });
  console.log('[BOT] Telegram Bot polling active. Listening for commands.');

  // /start command
  bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, "🛍️ Welcome to the AURA Store Manager Bot!\n\nTo manage products and receive notifications, please authorize yourself as an administrator using the `/auth` command.");
  });

  // /auth command
  bot.onText(/\/auth/, (msg) => {
    const chatId = msg.chat.id;
    const authorized = authorizeUser(chatId);
    if (authorized) {
      bot.sendMessage(chatId, "👑 Authorized! You are now registered as a store administrator. You will receive notifications when new orders are placed.");
    } else {
      bot.sendMessage(chatId, "👑 You are already authorized as a store administrator.");
    }
  });

  // /list command
  bot.onText(/\/list/, async (msg) => {
    const chatId = msg.chat.id;
    if (!isAuthorized(chatId)) {
      return bot.sendMessage(chatId, "❌ Unauthorized. Run `/auth` first.");
    }
    const products = getProducts();
    if (products.length === 0) {
      return bot.sendMessage(chatId, "📂 No products listed in the store yet.");
    }
    let response = "📦 **Listed Products:**\n\n";
    products.forEach(p => {
      response += `ID: \`${p.id}\` | **${p.name}**\nPrice: ₹${p.price} | Category: ${p.category}\n\n`;
    });
    bot.sendMessage(chatId, response, { parse_mode: 'Markdown' });
  });

  // /delete command
  bot.onText(/\/delete (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    if (!isAuthorized(chatId)) {
      return bot.sendMessage(chatId, "❌ Unauthorized.");
    }
    const productId = match[1].trim();
    const deleted = deleteProduct(productId);
    if (deleted) {
      bot.sendMessage(chatId, `✅ Product with ID \`${productId}\` has been deleted.`, { parse_mode: 'Markdown' });
    } else {
      bot.sendMessage(chatId, `❌ Product with ID \`${productId}\` not found.`, { parse_mode: 'Markdown' });
    }
  });

  // /orders command
  bot.onText(/\/orders/, async (msg) => {
    const chatId = msg.chat.id;
    if (!isAuthorized(chatId)) {
      return bot.sendMessage(chatId, "❌ Unauthorized.");
    }
    const orders = getOrders();
    if (orders.length === 0) {
      return bot.sendMessage(chatId, "📝 No orders placed yet.");
    }
    // Show 10 most recent orders
    const recent = orders.slice(0, 10);
    let response = "📋 **10 Most Recent Orders:**\n\n";
    recent.forEach(o => {
      const itemsDesc = o.items.map(item => `${item.name} (x${item.quantity})`).join(', ');
      response += `**Order ID:** \`${o.id}\`\nCustomer: ${o.customerName} | Phone: ${o.phone}\nItems: ${itemsDesc}\nTotal: ₹${o.totalAmount} | Status: **${o.status}**\n\n`;
    });
    bot.sendMessage(chatId, response, { parse_mode: 'Markdown' });
  });

  // Guided flow to add product
  bot.onText(/\/addproduct/, (msg) => {
    const chatId = msg.chat.id;
    if (!isAuthorized(chatId)) {
      return bot.sendMessage(chatId, "❌ Unauthorized.");
    }
    addProductSessions[chatId] = { step: 1 };
    bot.sendMessage(chatId, "🤖 **Guided Flow: Add Product**\n\nStep 1: Please upload/send the clothing item photo.");
  });

  // General message handler to capture guided steps and photo downloads
  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    
    // Skip if not an active addproduct session or if it's a command
    if (!addProductSessions[chatId] || (text && text.startsWith('/'))) return;

    const session = addProductSessions[chatId];

    // Step 1: Capture Photo
    if (session.step === 1) {
      if (!msg.photo) {
        return bot.sendMessage(chatId, "⚠️ Please send a valid photo/image upload of the clothing item.");
      }
      // Get the highest resolution photo
      const photo = msg.photo[msg.photo.length - 1];
      bot.sendMessage(chatId, "⏳ Downloading clothing photo to storefront database...");
      try {
        const fileLink = await bot.getFileLink(photo.file_id);
        const ext = path.extname(fileLink) || '.png';
        const filename = `product_${Date.now()}${ext}`;
        const uploadsDir = path.join(__dirname, 'public', 'uploads');
        if (!fs.existsSync(uploadsDir)) {
          fs.mkdirSync(uploadsDir, { recursive: true });
        }
        const uploadPath = path.join(uploadsDir, filename);
        
        // Download photo
        await downloadFile(fileLink, uploadPath);
        
        try {
          const fileBuffer = fs.readFileSync(uploadPath);
          const mimeType = ext === '.png' ? 'image/png' : (ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'application/octet-stream');
          const firebaseURL = await uploadToFirebaseStorage(filename, fileBuffer, mimeType, 'products');
          if (firebaseURL) {
            session.image = firebaseURL;
            try { fs.unlinkSync(uploadPath); } catch (e) {} // Clean up local file after Firebase upload
          } else {
            // Try Cloudinary as fallback
            const cloudinaryUrl = await uploadLocalFileToCloudinary(uploadPath);
            if (cloudinaryUrl) {
              session.image = cloudinaryUrl;
              try { fs.unlinkSync(uploadPath); } catch (e) {}
            } else {
              session.image = `/uploads/${filename}`;
            }
          }
        } catch (firebaseErr) {
          console.warn("[BOT] Firebase upload failed, trying Cloudinary...", firebaseErr.message);
          try {
            const cloudinaryUrl = await uploadLocalFileToCloudinary(uploadPath);
            if (cloudinaryUrl) {
              session.image = cloudinaryUrl;
              try { fs.unlinkSync(uploadPath); } catch (e) {}
            } else {
              session.image = `/uploads/${filename}`;
            }
          } catch (cloudErr) {
            console.warn("[BOT] Cloudinary upload failed, using local path:", cloudErr.message);
            session.image = `/uploads/${filename}`;
          }
        }
        
        session.step = 2;
        bot.sendMessage(chatId, "📸 Photo downloaded successfully!\n\nStep 2: Enter the **Product Name** (e.g. *Aura Varsity Hoodie*):");
      } catch (err) {
        console.error("Failed to download telegram photo:", err);
        bot.sendMessage(chatId, "❌ Failed to download photo. Please try `/addproduct` again.");
        delete addProductSessions[chatId];
      }
      return;
    }

    // Step 2: Product Name
    if (session.step === 2) {
      if (!text) return bot.sendMessage(chatId, "⚠️ Please enter a text name:");
      session.name = text.trim();
      session.step = 3;
      bot.sendMessage(chatId, `📝 Name set: *${session.name}*\n\nStep 3: Enter the **Product Description** (e.g. *Premium cotton relaxed fit hoodie*):`, { parse_mode: 'Markdown' });
      return;
    }

    // Step 3: Product Description
    if (session.step === 3) {
      if (!text) return bot.sendMessage(chatId, "⚠️ Please enter a text description:");
      session.description = text.trim();
      session.step = 4;
      bot.sendMessage(chatId, `📝 Description set.\n\nStep 4: Enter the **Product Price** in Rupees (e.g. *1299*):`);
      return;
    }

    // Step 4: Product Price
    if (session.step === 4) {
      const price = parseFloat(text);
      if (isNaN(price) || price <= 0) {
        return bot.sendMessage(chatId, "⚠️ Please enter a valid positive numerical price (e.g. *899*):");
      }
      session.price = price;
      session.step = 5;
      bot.sendMessage(chatId, `💰 Price set: ₹${session.price}\n\nStep 5: Enter the **Product Category** (e.g. *Hoodies*, *Tees*, *Outerwear*):`);
      return;
    }

    // Step 5: Product Category & Final Save
    if (session.step === 5) {
      if (!text) return bot.sendMessage(chatId, "⚠️ Please enter a category name:");
      session.category = text.trim();
      
      // Create the product in db
      const newProduct = addProduct({
        name: session.name,
        description: session.description,
        price: session.price,
        category: session.category,
        image: session.image,
        sizes: ["S", "M", "L", "XL"],
        colors: ["Default"],
        featured: true
      });

      bot.sendMessage(chatId, `🎉 **Product Successfully Added!**\n\nID: \`${newProduct.id}\`\nName: *${newProduct.name}*\nCategory: ${newProduct.category}\nPrice: ₹${newProduct.price}\n\nThe product is now live on the storefront! 🚀`, { parse_mode: 'Markdown' });
      delete addProductSessions[chatId];
      return;
    }
  });
}

// Broadcast order notifications to all authorized admins
export function notifyNewOrder(order) {
  if (!bot) return;
  const admins = getAuthorizedUsers();
  if (admins.length === 0) return;
  
  const itemsDesc = order.items.map(item => `• ${item.name} (x${item.quantity}) - Size: ${item.size || 'M'}`).join('\n');
  const message = `🔔 **NEW ORDER PLACED!**\n\n` +
    `**Order ID:** \`${order.id}\`\n` +
    `**Customer:** ${order.customerName}\n` +
    `**Phone:** ${order.phone}\n` +
    `**Email:** ${order.email}\n` +
    `**Address:** ${order.address}\n\n` +
    `**Items Ordered:**\n${itemsDesc}\n\n` +
    `💰 **Total Paid:** ₹${order.totalAmount}\n` +
    `📦 **Shipping:** Free`;

  admins.forEach(chatId => {
    bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  });
}

// Helper to check chat auth status
function isAuthorized(chatId) {
  const admins = getAuthorizedUsers();
  return admins.includes(chatId);
}

// Helper to download a photo from url
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
      response.pipe(file);
      file.on('finish', () => {
        file.close(resolve);
      });
    }).on('error', (err) => {
      fs.unlink(dest, () => reject(err));
    });
  });
}
