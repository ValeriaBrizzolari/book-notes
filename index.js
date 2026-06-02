/* ============================================================
 ============================================================ */
import express from "express";
import pg from "pg";

const app = express();
const port = process.env.PORT || 3000;

// ============================================================
//  Database connection
// ============================================================

const db = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false,
});

db.connect().catch((err) => console.error("DB connection error:", err));

// ============================================================
//  Middleware
// ============================================================

app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

app.set("view engine", "ejs");

// ============================================================
//  Helper: fetch books with optional sort
// ============================================================

async function getBooks(sort) {
  let query = "SELECT * FROM book_notes_books ORDER BY date_read DESC"; // default: recent

  if (sort === "rating") {
    query = "SELECT * FROM book_notes_books ORDER BY rating DESC";
  } else if (sort === "title") {
    query = "SELECT * FROM book_notes_books ORDER BY title ASC";
  }

  const result = await db.query(query);
  return result.rows;
}

// ============================================================
//  Helper: build Open Library cover URL from ISBN
// ============================================================

function buildCoverUrl(isbn) {
  return `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg`;
}

// ============================================================
//  Routes
// ============================================================

// GET / — render book list
app.get("/", async (req, res) => {
  const sort = req.query.sort || "recent";
  try {
    const books = await getBooks(sort);
    res.render("index", { books, sort });
  } catch (err) {
    console.error("Error fetching books:", err);
    res.status(500).send("Something went wrong loading your books.");
  }
});

// POST /books — add a new book
app.post("/books", async (req, res) => {
  const { title, author, isbn, rating, date_read, notes } = req.body;
  const coverUrl = buildCoverUrl(isbn);

  try {
    await db.query(
      `INSERT INTO book_notes_books (title, author, isbn, cover_url, rating, date_read, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [title, author, isbn, coverUrl, parseInt(rating), date_read, notes],
    );
    res.redirect("/");
  } catch (err) {
    console.error("Error adding book:", err);
    res.redirect("/");
  }
});

// PATCH /books/:id — update an existing book
app.post("/books/:id", async (req, res) => {
  const { id } = req.params;
  const { title, author, isbn, rating, date_read, notes } = req.body;
  const coverUrl = buildCoverUrl(isbn);

  try {
    await db.query(
      `UPDATE book_notes_books
       SET title = $1, author = $2, isbn = $3, cover_url = $4,
           rating = $5, date_read = $6, notes = $7
       WHERE id = $8`,
      [title, author, isbn, coverUrl, parseInt(rating), date_read, notes, id],
    );
    res.redirect("/");
  } catch (err) {
    console.error("Error updating book:", err);
    res.redirect("/");
  }
});

// POST /books/:id/delete — delete a book (method-override workaround for DELETE)
app.post("/books/:id/delete", async (req, res) => {
  const { id } = req.params;

  try {
    await db.query("DELETE FROM book_notes_books WHERE id = $1", [id]);
    res.redirect("/");
  } catch (err) {
    console.error("Error deleting book:", err);
    res.redirect("/");
  }
});

// ============================================================
//  Start server
// ============================================================

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
