/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcrypt');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const port = process.env.PORT || 3000;

// --- DATABASE SETUP ---
const db = new sqlite3.Database('./warehouse.db', (err) => {
    if (err) {
        console.error("Error opening database", err.message);
    } else {
        console.log("Connected to the SQLite database.");
    }
});

// Password hashing setup
const saltRounds = 10;

// --- DATABASE INITIALIZATION ---
function initializeDatabase() {
    return new Promise(async (resolve, reject) => {
        db.serialize(async () => {
            // Create tables if they don't exist
            db.run(`CREATE TABLE IF NOT EXISTS clients (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                joinDate TEXT NOT NULL,
                type TEXT NOT NULL,
                phone TEXT NOT NULL,
                address TEXT NOT NULL,
                email TEXT NOT NULL,
                comment TEXT
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                role TEXT NOT NULL,
                status TEXT NOT NULL,
                password TEXT NOT NULL,
                clientId INTEGER,
                FOREIGN KEY (clientId) REFERENCES clients (id) ON DELETE SET NULL
            )`);
            
            db.run(`CREATE TABLE IF NOT EXISTS stockMovements (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                clientId INTEGER NOT NULL,
                type TEXT NOT NULL,
                product TEXT NOT NULL,
                totalWeight REAL NOT NULL,
                plasticBoxCount INTEGER,
                plasticBoxWeight REAL,
                woodBoxCount INTEGER,
                woodBoxWeight REAL,
                productWeight REAL NOT NULL,
                date TEXT NOT NULL,
                recordedByUserId INTEGER NOT NULL,
                comment TEXT,
                farmerComment TEXT,
                isCommentRead BOOLEAN,
                FOREIGN KEY (clientId) REFERENCES clients (id),
                FOREIGN KEY (recordedByUserId) REFERENCES users (id)
            )`);
            
            // Check if admin user exists
            db.get("SELECT COUNT(*) as count FROM users WHERE role = 'Admin'", async (err, row) => {
                if (err) return reject(err);
                if (row.count === 0) {
                    console.log("No admin user found, creating one...");
                    const hashedPassword = await bcrypt.hash('password', saltRounds);
                    db.run("INSERT INTO users (username, name, role, status, password) VALUES (?, ?, ?, ?, ?)", 
                        ['admin', 'Alice Durand', 'Admin', 'Active', hashedPassword], 
                        (err) => {
                            if (err) return reject(err);
                            console.log("Initial admin user created with password 'password'.");
                            resolve();
                        }
                    );
                } else {
                    console.log("Admin user already exists.");
                    resolve();
                }
            });
        });
    });
}

// --- MIDDLEWARE ---
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// --- SERVER-SIDE HELPER FUNCTIONS for Stock Validation ---
async function getClientStockSummary(clientId) {
    return new Promise((resolve, reject) => {
        db.all("SELECT * FROM stockMovements WHERE clientId = ?", [clientId], (err, movements) => {
            if (err) return reject(err);
            const summary = { totalWeight: 0, productWeight: 0, plasticBoxes: 0, woodBoxes: 0 };
            movements.forEach(movement => {
                const multiplier = movement.type === 'in' ? 1 : -1;
                summary.totalWeight += movement.totalWeight * multiplier;
                summary.productWeight += movement.productWeight * multiplier;
                if (movement.plasticBoxCount) {
                    summary.plasticBoxes += movement.plasticBoxCount * multiplier;
                }
                if (movement.woodBoxCount) {
                    summary.woodBoxes += movement.woodBoxCount * multiplier;
                }
            });
            resolve(summary);
        });
    });
}

async function getProductStockForClient(clientId, product) {
    return new Promise((resolve, reject) => {
        db.all("SELECT type, productWeight FROM stockMovements WHERE clientId = ? AND product = ?", [clientId, product], (err, movements) => {
            if (err) return reject(err);
            const stock = movements.reduce((acc, movement) => {
                const multiplier = movement.type === 'in' ? 1 : -1;
                return acc + (movement.productWeight * multiplier);
            }, 0);
            resolve(stock);
        });
    });
}

// --- API ROUTES: CLIENTS ---
app.get('/api/clients', (req, res) => {
    db.all("SELECT * FROM clients", [], (err, rows) => {
        if (err) return res.status(500).json({ message: "Database error", error: err.message });
        res.json(rows);
    });
});

app.post('/api/clients', (req, res) => {
    const { name, type, phone, address, email, comment } = req.body;
    if (!name || !type || !phone || !address || !email) {
        return res.status(400).json({ message: 'Missing required client fields.' });
    }
    const joinDate = new Date().toISOString().split('T')[0];
    const sql = `INSERT INTO clients (name, type, phone, address, email, comment, joinDate) VALUES (?, ?, ?, ?, ?, ?, ?)`;
    db.run(sql, [name, type, phone, address, email, comment, joinDate], function(err) {
        if (err) return res.status(500).json({ message: "Database error", error: err.message });
        db.get("SELECT * FROM clients WHERE id = ?", [this.lastID], (err, row) => {
            if (err) return res.status(500).json({ message: "Database error", error: err.message });
            console.log(`Client added: ${row.name} (ID: ${row.id})`);
            res.status(201).json(row);
        });
    });
});


// --- API ROUTES: USERS & AUTH ---
app.post('/api/login', (req, res) => {
    const { username, password, role } = req.body;
    if (!username || !password || !role) {
        return res.status(400).json({ message: 'Username, password, and role are required.' });
    }

    db.get("SELECT * FROM users WHERE lower(username) = lower(?) AND role = ?", [username, role], async (err, user) => {
        if (err) return res.status(500).json({ message: "Database error", error: err.message });
        if (!user) return res.status(401).json({ message: 'Invalid credentials or role.' });
        
        const passwordMatch = await bcrypt.compare(password, user.password);
        if (!passwordMatch) return res.status(401).json({ message: 'Invalid credentials or role.' });
        if (user.status === 'Suspended') return res.status(403).json({ message: 'This account has been suspended.' });
        
        const { password: _, ...userToReturn } = user;
        res.json(userToReturn);
    });
});

app.get('/api/users', (req, res) => {
    db.all("SELECT id, username, name, role, status, clientId FROM users", [], (err, rows) => {
        if (err) return res.status(500).json({ message: "Database error", error: err.message });
        res.json(rows);
    });
});

app.post('/api/users', async (req, res) => {
    const { name, username, password, role, clientId } = req.body;
    if (!name || !username || !password || !role) {
        return res.status(400).json({ message: 'Missing required fields for new user.' });
    }
    
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    const sql = `INSERT INTO users (name, username, password, role, status, clientId) VALUES (?, ?, ?, ?, ?, ?)`;
    const params = [name, username, hashedPassword, role, 'Active', role === 'Agriculteur' ? clientId : null];

    db.run(sql, params, function(err) {
        if (err) {
            if (err.message.includes('UNIQUE constraint failed')) {
                return res.status(409).json({ message: 'Username already exists.' });
            }
            return res.status(500).json({ message: "Database error", error: err.message });
        }
        db.get("SELECT id, username, name, role, status, clientId FROM users WHERE id = ?", [this.lastID], (err, row) => {
            if (err) return res.status(500).json({ message: "Database error", error: err.message });
            console.log(`User created: ${row.name} (ID: ${row.id})`);
            res.status(201).json(row);
        });
    });
});

app.put('/api/users/:id', async (req, res) => {
    const userId = parseInt(req.params.id, 10);
    const { name, username, role, clientId, password, status } = req.body;
    
    let updates = [];
    let params = [];
    if (name) { updates.push("name = ?"); params.push(name); }
    if (username) { updates.push("username = ?"); params.push(username); }
    if (role) { updates.push("role = ?"); params.push(role); }
    if (status) { updates.push("status = ?"); params.push(status); }
    updates.push("clientId = ?");
    params.push(role === 'Agriculteur' ? clientId : null);

    if (password) {
        const hashedPassword = await bcrypt.hash(password, saltRounds);
        updates.push("password = ?");
        params.push(hashedPassword);
    }
    
    if (updates.length === 0) return res.status(400).json({ message: 'No fields to update.' });

    params.push(userId);
    const sql = `UPDATE users SET ${updates.join(', ')} WHERE id = ?`;

    db.run(sql, params, function(err) {
        if (err) return res.status(500).json({ message: "Database error", error: err.message });
        if (this.changes === 0) return res.status(404).json({ message: 'User not found.' });
        
        db.get("SELECT id, username, name, role, status, clientId FROM users WHERE id = ?", [userId], (err, row) => {
            if (err) return res.status(500).json({ message: "Database error", error: err.message });
            console.log(`User updated: ${row.name} (ID: ${row.id})`);
            res.json(row);
        });
    });
});

app.delete('/api/users/:id', (req, res) => {
    const userId = parseInt(req.params.id, 10);
    db.get("SELECT role FROM users WHERE id = ?", [userId], (err, user) => {
        if (err) return res.status(500).json({ message: "Database error", error: err.message });
        if (!user) return res.status(404).json({ message: 'User not found' });
        if (user.role === 'Admin') return res.status(403).json({ message: 'Cannot delete an admin user.' });
        
        db.run("DELETE FROM users WHERE id = ?", [userId], function(err) {
            if (err) return res.status(500).json({ message: "Database error", error: err.message });
            console.log(`User deleted (ID: ${userId})`);
            res.status(204).send();
        });
    });
});


// --- API ROUTES: STOCK MOVEMENTS ---
app.get('/api/movements', (req, res) => {
    db.all("SELECT * FROM stockMovements", [], (err, rows) => {
        if (err) return res.status(500).json({ message: "Database error", error: err.message });
        // Convert boolean from 0/1 for frontend
        const movements = rows.map(m => ({ ...m, isCommentRead: !!m.isCommentRead }));
        res.json(movements);
    });
});

app.post('/api/movements', async (req, res) => {
    const { clientId, type, product, totalWeight, plasticBoxCount, plasticBoxWeight, woodBoxCount, woodBoxWeight, recordedByUserId, comment } = req.body;

    if (!clientId || !type || !product || !totalWeight || !recordedByUserId) {
        return res.status(400).json({ message: 'Missing required fields for movement.' });
    }
    
    const pBoxCount = plasticBoxCount || 0;
    const pBoxWeight = plasticBoxWeight || 0;
    const wBoxCount = woodBoxCount || 0;
    const wBoxWeight = woodBoxWeight || 0;
    const productWeight = totalWeight - (pBoxCount * pBoxWeight) - (wBoxCount * wBoxWeight);

    if (productWeight < 0) {
        return res.status(400).json({ message: 'Le poids net du produit est négatif. Vérifiez le poids total et les détails des box.' });
    }

    try {
        if (type === 'out') {
            const availableProductStock = await getProductStockForClient(clientId, product);
            if (productWeight > availableProductStock) {
                return res.status(400).json({ message: `Stock de produit net insuffisant. Stock disponible: ${availableProductStock.toFixed(2)} kg. Sortie demandée: ${productWeight.toFixed(2)} kg.` });
            }
            const clientStock = await getClientStockSummary(clientId);
            if (pBoxCount > clientStock.plasticBoxes) {
                return res.status(400).json({ message: `Stock de box en plastique insuffisant. Box disponibles: ${clientStock.plasticBoxes}. Sortie demandée: ${pBoxCount}.` });
            }
            if (wBoxCount > clientStock.woodBoxes) {
                return res.status(400).json({ message: `Stock de box en bois insuffisant. Box disponibles: ${clientStock.woodBoxes}. Sortie demandée: ${wBoxCount}.` });
            }
        }
    } catch (err) {
        return res.status(500).json({ message: "Database error during validation", error: err.message });
    }

    const sql = `INSERT INTO stockMovements (clientId, type, product, totalWeight, productWeight, plasticBoxCount, plasticBoxWeight, woodBoxCount, woodBoxWeight, date, recordedByUserId, comment) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const params = [
        clientId, type, product, totalWeight, productWeight,
        pBoxCount > 0 ? pBoxCount : null, pBoxCount > 0 ? pBoxWeight : null,
        wBoxCount > 0 ? wBoxCount : null, wBoxCount > 0 ? wBoxWeight : null,
        new Date().toISOString().split('T')[0],
        recordedByUserId, comment?.trim() ? comment.trim() : null
    ];
    
    db.run(sql, params, function(err) {
        if (err) return res.status(500).json({ message: "Database error", error: err.message });
        db.get("SELECT * FROM stockMovements WHERE id = ?", [this.lastID], (err, row) => {
            if (err) return res.status(500).json({ message: "Database error", error: err.message });
            console.log(`Movement created for client ${clientId} (ID: ${row.id})`);
            res.status(201).json(row);
        });
    });
});

app.patch('/api/movements/:id', (req, res) => {
    const movementId = parseInt(req.params.id, 10);
    const { farmerComment, isCommentRead } = req.body;

    let updates = [];
    let params = [];
    if (typeof farmerComment === 'string') {
        updates.push("farmerComment = ?");
        params.push(farmerComment);
        updates.push("isCommentRead = ?");
        params.push(false); // A new/updated comment is always unread
    }
    if (typeof isCommentRead === 'boolean') {
        updates.push("isCommentRead = ?");
        params.push(isCommentRead);
    }

    if (updates.length === 0) return res.status(400).json({ message: 'No fields to update' });
    
    params.push(movementId);
    const sql = `UPDATE stockMovements SET ${updates.join(', ')} WHERE id = ?`;

    db.run(sql, params, function(err) {
        if (err) return res.status(500).json({ message: "Database error", error: err.message });
        if (this.changes === 0) return res.status(404).json({ message: 'Movement not found.' });
        
        db.get("SELECT * FROM stockMovements WHERE id = ?", [movementId], (err, row) => {
            if (err) return res.status(500).json({ message: "Database error", error: err.message });
            console.log(`Movement ID ${movementId} updated.`);
            res.json({ ...row, isCommentRead: !!row.isCommentRead });
        });
    });
});


// --- SERVER STARTUP ---
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

initializeDatabase().then(() => {
    app.listen(port, () => {
        console.log(`Server listening at http://localhost:${port}`);
        console.log("Stop the server with CTRL+C. Run 'npm install' if you haven't, then 'node server.js' to start.");
    });
}).catch(err => {
    console.error("Failed to initialize database:", err);
    process.exit(1);
});
