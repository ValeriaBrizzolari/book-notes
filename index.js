import express from "express";
import pg from "pg";
import bcrypt from "bcrypt";
import passport from "passport";
import { Strategy } from "passport-local";
import GoogleStrategy from "passport-google-oauth2";
import session from "express-session";
import env from "dotenv";

env.config();

const app = express();
const port = process.env.PORT || 3000;
const saltRounds = 10;
const BASE_URL = process.env.BASE_URL || `http://localhost:${port}`;

const db = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

db.connect().catch((err) => console.error("DB connection error:", err));

app.set("trust proxy", 1);

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    cookie: {
      secure: process.env.NODE_ENV === "production",
    },
  }),
);

app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

app.set("view engine", "ejs");

app.use(passport.initialize());
app.use(passport.session());

function requireAuth(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.redirect("/login");
}

// ============================================================
//  Helper: fetch books with optional sort, scoped to one user
// ============================================================

async function getBooks(userId, sort) {
  let query = "SELECT * FROM books WHERE user_id = $1 ORDER BY date_read DESC"; // default: recent

  if (sort === "rating") {
    query = "SELECT * FROM books WHERE user_id = $1 ORDER BY rating DESC";
  } else if (sort === "title") {
    query = "SELECT * FROM books WHERE user_id = $1 ORDER BY title ASC";
  }

  const result = await db.query(query, [userId]);
  return result.rows;
}

// ============================================================
//  Helper: build Open Library cover URL from ISBN
// ============================================================

function buildCoverUrl(isbn) {
  return `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg`;
}

app.get("/login", (req, res) => {
  res.render("login", { user: req.user || null });
});

app.get("/register", (req, res) => {
  res.render("register", { user: req.user || null });
});

app.get("/logout", (req, res, next) => {
  req.logout(function (err) {
    if (err) {
      return next(err);
    }
    res.redirect("/login");
  });
});

app.post("/account", requireAuth, async (req, res) => {
  const { email, currentPassword, newPassword } = req.body;

  try {
    const result = await db.query("SELECT * FROM users WHERE id = $1", [
      req.user.id,
    ]);

    const currentUser = result.rows[0];

    if (currentUser.password) {
      const valid =
        currentPassword &&
        (await bcrypt.compare(currentPassword, currentUser.password));

      if (!valid) {
        return res.redirect("/");
      }
    }

    const newHashedPassword =
      newPassword && newPassword.trim() !== ""
        ? await bcrypt.hash(newPassword, saltRounds)
        : currentUser.password;

    await db.query("UPDATE users SET email = $1, password = $2 WHERE id = $3", [
      email,
      newHashedPassword,
      req.user.id,
    ]);

    res.redirect("/");
  } catch (err) {
    console.error("Error updating account:", err);
    res.redirect("/");
  }
});

app.post(
  "/login",
  passport.authenticate("local", {
    successRedirect: "/",
    failureRedirect: "/login",
  }),
);

app.post("/register", async (req, res) => {
  const email = req.body.username;
  const password = req.body.password;

  try {
    const checkResult = await db.query("SELECT * FROM users WHERE email = $1", [
      email,
    ]);

    if (checkResult.rows.length > 0) {
      res.redirect("/login");
    } else {
      bcrypt.hash(password, saltRounds, async (err, hash) => {
        if (err) {
          console.error("Error hashing password:", err);
          return res.redirect("/register");
        }
        try {
          const result = await db.query(
            "INSERT INTO users (email, password) VALUES ($1, $2) RETURNING *",
            [email, hash],
          );
          const user = result.rows[0];
          req.login(user, (err) => {
            if (err) {
              console.error("Error logging in new user:", err);
              return res.redirect("/login");
            }
            res.redirect("/");
          });
        } catch (err) {
          console.error("Error creating user:", err);
          res.redirect("/register");
        }
      });
    }
  } catch (err) {
    console.error(err);
    res.redirect("/register");
  }
});

app.get(
  "/auth/google",
  passport.authenticate("google", {
    scope: ["profile", "email"],
  }),
);

app.get(
  "/auth/google/books",
  passport.authenticate("google", {
    successRedirect: "/",
    failureRedirect: "/login",
  }),
);

// GET / — render the logged-in user's own shelf
app.get("/", requireAuth, async (req, res) => {
  const sort = req.query.sort || "recent";
  try {
    const books = await getBooks(req.user.id, sort);
    res.render("index", { books, sort, user: req.user });
  } catch (err) {
    console.error("Error fetching books:", err);
    res.status(500).send("Something went wrong loading your books.");
  }
});

// POST /books — add a new book to the logged-in user's shelf
app.post("/books", requireAuth, async (req, res) => {
  const { title, author, isbn, rating, date_read, notes } = req.body;
  const coverUrl = buildCoverUrl(isbn);

  try {
    await db.query(
      `INSERT INTO books (title, author, isbn, cover_url, rating, date_read, notes, user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        title,
        author,
        isbn,
        coverUrl,
        parseInt(rating),
        date_read,
        notes,
        req.user.id,
      ],
    );
    res.redirect("/");
  } catch (err) {
    console.error("Error adding book:", err);
    res.redirect("/");
  }
});

// POST /books/:id — update an existing book (only if it belongs to this user)
app.post("/books/:id", requireAuth, async (req, res) => {
  const { id } = req.params;
  const { title, author, isbn, rating, date_read, notes } = req.body;
  const coverUrl = buildCoverUrl(isbn);

  try {
    await db.query(
      `UPDATE books
       SET title = $1, author = $2, isbn = $3, cover_url = $4,
           rating = $5, date_read = $6, notes = $7
       WHERE id = $8 AND user_id = $9`,
      [
        title,
        author,
        isbn,
        coverUrl,
        parseInt(rating),
        date_read,
        notes,
        id,
        req.user.id,
      ],
    );
    res.redirect("/");
  } catch (err) {
    console.error("Error updating book:", err);
    res.redirect("/");
  }
});

// POST /books/:id/delete — delete a book (only if it belongs to this user)
app.post("/books/:id/delete", requireAuth, async (req, res) => {
  const { id } = req.params;

  try {
    await db.query("DELETE FROM books WHERE id = $1 AND user_id = $2", [
      id,
      req.user.id,
    ]);
    res.redirect("/");
  } catch (err) {
    console.error("Error deleting book:", err);
    res.redirect("/");
  }
});

passport.use(
  "local",
  new Strategy(async function verify(username, password, cb) {
    try {
      const result = await db.query("SELECT * FROM users WHERE email = $1", [
        username,
      ]);
      if (result.rows.length > 0) {
        const user = result.rows[0];
        const storedHashedPassword = user.password;
        bcrypt.compare(password, storedHashedPassword, (err, valid) => {
          if (err) {
            console.error("Error comparing passwords:", err);
            return cb(err);
          }
          if (valid) {
            return cb(null, user);
          }
          return cb(null, false);
        });
      } else {
        return cb(null, false);
      }
    } catch (err) {
      return cb(err);
    }
  }),
);

passport.use(
  "google",
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: `${BASE_URL}/auth/google/books`,
      userProfileURL: "https://www.googleapis.com/oauth2/v3/userinfo",
    },
    async (accessToken, refreshToken, profile, cb) => {
      try {
        const result = await db.query("SELECT * FROM users WHERE email = $1", [
          profile.email,
        ]);
        if (result.rows.length === 0) {
          const newUser = await db.query(
            "INSERT INTO users (email, password) VALUES ($1, $2) RETURNING *",
            [profile.email, null],
          );
          return cb(null, newUser.rows[0]);
        } else {
          return cb(null, result.rows[0]);
        }
      } catch (err) {
        return cb(err);
      }
    },
  ),
);

passport.serializeUser((user, cb) => {
  cb(null, user.id);
});

passport.deserializeUser(async (id, cb) => {
  try {
    const result = await db.query("SELECT * FROM users WHERE id = $1", [id]);
    cb(null, result.rows[0]);
  } catch (err) {
    cb(err);
  }
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
