
const express = require("express");
const path = require("path");
const cors = require("cors");
const mysql = require("mysql2/promise");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// Serve the existing frontend files
app.use(express.static(path.join(__dirname, "public")));
const dbConfig = {
    host: process.env.DB_HOST || "localhost",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    waitForConnections: true,
    connectionLimit: 10
};

let db;

async function connectDatabase() {
    try {
        const connection = await mysql.createConnection({
            host: dbConfig.host,
            user: dbConfig.user,
            password: dbConfig.password
        });

        await connection.query(
            "CREATE DATABASE IF NOT EXISTS agrinexa"
        );

        await connection.end();

        db = mysql.createPool({
            ...dbConfig,
            database: "agrinexa"
        });

        console.log("MySQL connected successfully!");

        await db.query(`
            CREATE TABLE IF NOT EXISTS users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                email VARCHAR(150) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                role ENUM('farmer', 'buyer', 'worker') NOT NULL,
                phone VARCHAR(20),
                location VARCHAR(150),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS crop_listings (
                id INT AUTO_INCREMENT PRIMARY KEY,
                farmer_id INT NOT NULL,
                crop_name VARCHAR(100) NOT NULL,
                quantity DECIMAL(10,2) NOT NULL,
                price DECIMAL(10,2) NOT NULL,
                location VARCHAR(150),
                description TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (farmer_id) REFERENCES users(id)
            )
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS worker_services (
                id INT AUTO_INCREMENT PRIMARY KEY,
                worker_id INT NOT NULL,
                service_name VARCHAR(150) NOT NULL,
                price DECIMAL(10,2),
                location VARCHAR(150),
                description TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (worker_id) REFERENCES users(id)
            )
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS farmer_requests (
                id INT AUTO_INCREMENT PRIMARY KEY,
                farmer_id INT NOT NULL,
                request_type VARCHAR(100) NOT NULL,
                description TEXT,
                status VARCHAR(30) DEFAULT 'Pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (farmer_id) REFERENCES users(id)
            )
        `);

        console.log("AgriNexa database and tables are ready!");

    } catch (error) {
        console.error("Database connection error:", error.message);
        process.exit(1);
    }
}

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/api/status", async (req, res) => {
    try {
        await db.query("SELECT 1");

        res.json({
            success: true,
            message: "Backend and MySQL are connected!"
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

app.get("/api/crops", async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT crop_listings.*, users.name AS farmer_name,
            users.phone AS farmer_phone
            FROM crop_listings
            JOIN users ON crop_listings.farmer_id = users.id
            ORDER BY crop_listings.created_at DESC
        `);

        res.json(rows);

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

app.get("/api/workers", async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT worker_services.*, users.name AS worker_name,
            users.phone AS worker_phone
            FROM worker_services
            JOIN users ON worker_services.worker_id = users.id
            ORDER BY worker_services.created_at DESC
        `);

        res.json(rows);

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});
// =====================================
// REGISTER API
// =====================================

const bcrypt = require("bcryptjs");

app.post("/api/register", async (req, res) => {
    try {
        const {
            name,
            email,
            password,
            role,
            phone,
            location
        } = req.body;

        if (!name || !email || !password || !role) {
            return res.status(400).json({
                success: false,
                message: "Please fill all required fields."
            });
        }

        if (!["farmer", "buyer", "worker"].includes(role)) {
            return res.status(400).json({
                success: false,
                message: "Invalid user role."
            });
        }

        if (password.length < 6) {
            return res.status(400).json({
                success: false,
                message: "Password must contain at least 6 characters."
            });
        }

        const [existingUsers] = await db.query(
            "SELECT id FROM users WHERE email = ?",
            [email.trim().toLowerCase()]
        );

        if (existingUsers.length > 0) {
            return res.status(409).json({
                success: false,
                message: "Email is already registered."
            });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const [result] = await db.query(
            `INSERT INTO users
            (name, email, password, role, phone, location)
            VALUES (?, ?, ?, ?, ?, ?)`,
            [
                name.trim(),
                email.trim().toLowerCase(),
                hashedPassword,
                role,
                phone || null,
                location || null
            ]
        );

        res.status(201).json({
            success: true,
            message: "Registration successful!",
            userId: result.insertId
        });

    } catch (error) {
        console.error("Registration error:", error.message);

        res.status(500).json({
            success: false,
            message: "Registration failed. Please try again."
        });
    }
});


// =====================================
// LOGIN API
// =====================================

app.post("/api/login", async (req, res) => {
    try {
        const { email, password, role } = req.body;

        if (!email || !password || !role) {
            return res.status(400).json({
                success: false,
                message: "Please fill all fields."
            });
        }

        const [users] = await db.query(
            `SELECT id, name, email, password, role, phone, location
             FROM users
             WHERE email = ? AND role = ?`,
            [
                email.trim().toLowerCase(),
                role
            ]
        );

        if (users.length === 0) {
            return res.status(401).json({
                success: false,
                message: "Email, password, or role is incorrect."
            });
        }

        const user = users[0];

        const passwordMatch = await bcrypt.compare(
            password,
            user.password
        );

        if (!passwordMatch) {
            return res.status(401).json({
                success: false,
                message: "Email, password, or role is incorrect."
            });
        }

        res.json({
            success: true,
            message: "Login successful!",
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role,
                phone: user.phone,
                location: user.location
            }
        });

    } catch (error) {
        console.error("Login error:", error.message);

        res.status(500).json({
            success: false,
            message: "Login failed. Please try again."
        });
    }
});
async function startServer() {
    await connectDatabase();

    app.listen(PORT, () => {
        console.log(
            `AgriNexa server running at http://localhost:${PORT}`
        );
    });
}

startServer();