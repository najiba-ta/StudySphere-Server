const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const { MongoClient, ObjectId } = require("mongodb");
const { createRemoteJWKSet, jwtVerify } = require("jose-cjs");

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

app.use(
  cors({
    origin: process.env.CLIENT_URL,
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

const client = new MongoClient(process.env.MONGO_URI);

const JWKS = createRemoteJWKSet(
  new URL(`${process.env.CLIENT_URL}/api/auth/jwks`)
);

const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ message: "No token provided" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const { payload } = await jwtVerify(token, JWKS);

    req.user = {
      id: payload.id || payload.sub,
      email: payload.email,
    };

    next();
  } catch (err) {
    return res.status(403).json({ message: "Invalid token" });
  }
};

async function run() {
  try {
    // await client.connect();
    console.log("MongoDB Connected");

    const db = client.db("studysphere");
    const rooms = db.collection("rooms");
    const bookings = db.collection("bookings");

    app.get("/", (req, res) => {
      res.send("Server Running");
    });

    app.delete("/rooms-delete/:id", verifyToken, async (req, res) => {
      const id = req.params.id
      const filter = {_id: new ObjectId(id)}
      const result = await rooms.deleteOne(filter)
      res.send(result)
    });

    app.get("/rooms", async (req, res) => {
      try {
        const { search, amenities, min, max } = req.query;

        let query = {};

        if (search) {
          query.roomName = { $regex: search, $options: "i" };
        }

        if (amenities) {
          const arr = amenities.split(",");
          query.amenities = { $in: arr };
        }

        if (min || max) {
          query.hourlyRate = {};
          if (min) query.hourlyRate.$gte = Number(min);
          if (max) query.hourlyRate.$lte = Number(max);
        }

        const data = await rooms.find(query).toArray();
        res.json(data);
      } catch (err) {
        res.status(500).json({ message: "Server error" });
      }
    });

    app.get("/rooms/latest", async (req, res) => {
      const data = await rooms.find().sort({ _id: -1 }).limit(6).toArray();
      res.json(data);
    });

    app.get("/rooms/:id", verifyToken, async (req, res) => {
      try {
        const room = await rooms.findOne({
          _id: new ObjectId(req.params.id),
        });

        if (!room) return res.status(404).json({ message: "Not found" });

        res.json(room);
      } catch {
        res.status(400).json({ message: "Invalid ID" });
      }
    });

    app.post("/rooms", verifyToken, async (req, res) => {
      try {
        const result = await rooms.insertOne({
          ...req.body,
          ownerId: req.user.id,
          bookingCount: 0,
          createdAt: new Date(),
        });

        res.status(201).json(result);
      } catch {
        res.status(500).json({ message: "Create failed" });
      }
    });

    app.patch("/rooms/:id", verifyToken, async (req, res) => {
      try {
        const room = await rooms.findOne({
          _id: new ObjectId(req.params.id),
        });

        if (!room) return res.status(404).json({ message: "Not found" });

        if (room.ownerId !== req.user.id) {
          return res.status(403).json({ message: "Unauthorized" });
        }

        const result = await rooms.updateOne(
          { _id: room._id },
          { $set: req.body }
        );

        res.json(result);
      } catch {
        res.status(500).json({ message: "Update failed" });
      }
    });


    app.get("/my-listings/:userId", verifyToken, async (req, res) => {
      try {
        if (req.params.userId !== req.user.id) {
          return res.status(403).json({ message: "Unauthorized" });
        }

        const data = await rooms
          .find({ ownerId: req.user.id })
          .toArray();

        res.json(data);
      } catch {
        res.status(500).json({ message: "Failed to fetch listings" });
      }
    });

    app.post("/bookings", verifyToken, async (req, res) => {
      try {
        const room = await rooms.findOne({
          _id: new ObjectId(req.body.roomId),
        });

        if (!room) return res.status(404).json({ message: "Room not found" });

        const booking = {
          roomId: req.body.roomId,
          userId: req.user.id,
          userName: req.body.userName,
          date: new Date(req.body.date).toISOString(),
          startTime: req.body.startTime,
          endTime: req.body.endTime,
          totalCost: req.body.totalCost,
          note: req.body.note || "",
          roomName: room.roomName,
          roomImage: room.image,
          status: "confirmed",
          createdAt: new Date(),
        };

        const result = await bookings.insertOne(booking);

        await rooms.updateOne(
          { _id: room._id },
          { $inc: { bookingCount: 1 } }
        );

        res.status(201).json(result);
      } catch {
        res.status(500).json({ message: "Booking failed" });
      }
    });

    app.get("/bookings", verifyToken, async (req, res) => {
      try {
        const data = await bookings
          .find({ userId: req.user.id })
          .toArray();

        res.json(data);
      } catch {
        res.status(500).json({ message: "Failed to fetch bookings" });
      }
    });

    app.patch("/bookings/:id/cancel", verifyToken, async (req, res) => {
      try {
        const booking = await bookings.findOne({
          _id: new ObjectId(req.params.id),
        });

        if (!booking) return res.status(404).json({ message: "Not found" });

        if (booking.userId !== req.user.id) {
          return res.status(403).json({ message: "Unauthorized" });
        }

        await bookings.updateOne(
          { _id: booking._id },
          { $set: { status: "cancelled" } }
        );

        res.json({ success: true });
      } catch {
        res.status(500).json({ message: "Cancel failed" });
      }
    });

  
    app.listen(8000, () => {
      console.log("Server running on port 8000");
    });

  } catch (err) {
    console.error("DB connection error:", err);
  }
}

run();
// guiguoioyioyu8igtuftvjg