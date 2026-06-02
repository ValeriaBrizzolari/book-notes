// ============================================================
//   MY READING LOG — Client-side JS
//   Handles: modals, star pickers, delete confirmation, footer year
// ============================================================

/* ----- Footer year ----- */
document.getElementById("year").textContent = new Date().getFullYear();

/* ----- Modal helpers ----- */
function openModal(id) {
  document.getElementById(id).classList.add("open");
  document.body.style.overflow = "hidden";
}

function closeModal(id) {
  document.getElementById(id).classList.remove("open");
  document.body.style.overflow = "";
}

// Close modal when clicking the dark overlay (not the card itself)
function closeOnOverlay(event, id) {
  if (event.target === event.currentTarget) closeModal(id);
}

// Close any open modal on Escape key
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    document.querySelectorAll(".modal-overlay.open").forEach((el) => {
      closeModal(el.id);
    });
  }
});

/* ----- Star picker factory ----- */
// Attaches interactive star-picking behaviour to a container
function initStarPicker(containerId, hiddenInputId, initialValue = 0) {
  const container = document.getElementById(containerId);
  const hiddenInput = document.getElementById(hiddenInputId);
  const stars = container.querySelectorAll(".star-pick");

  // Set initial visual state
  setStars(initialValue);

  stars.forEach((star) => {
    const val = parseInt(star.dataset.val);

    // Hover preview
    star.addEventListener("mouseenter", () => highlightUpTo(val));
    star.addEventListener("mouseleave", () =>
      setStars(parseInt(hiddenInput.value)),
    );

    // Click to set
    star.addEventListener("click", () => {
      hiddenInput.value = val;
      setStars(val);
    });
  });

  function highlightUpTo(n) {
    stars.forEach((s) => {
      s.classList.toggle("selected", parseInt(s.dataset.val) <= n);
    });
  }

  function setStars(n) {
    stars.forEach((s) => {
      s.classList.toggle("selected", parseInt(s.dataset.val) <= n);
    });
  }
}

// Initialise the "Add" modal star picker on page load
initStarPicker("add-stars", "add-rating-val", 0);

/* ----- Detail modal ----- */
function openDetail(book) {
  // Cover
  const cover = document.getElementById("detail-cover");
  const fallback = document.getElementById("detail-fallback");
  const fallbackTitle = document.getElementById("detail-fallback-title");
  const fallbackAuthor = document.getElementById("detail-fallback-author");
  cover.src = book.cover_url;
  cover.alt = `Cover of ${book.title}`;
  cover.style.display = "block";
  fallback.style.display = "none";
  fallbackTitle.textContent = book.title;
  fallbackAuthor.textContent = book.author;

  // Stars
  const starsEl = document.getElementById("detail-stars");
  starsEl.innerHTML = "";
  for (let i = 1; i <= 5; i++) {
    const s = document.createElement("span");
    s.className = `star ${i <= book.rating ? "filled" : ""}`;
    s.textContent = "★";
    starsEl.appendChild(s);
  }

  // Text fields
  document.getElementById("detail-date").textContent = new Date(
    book.date_read,
  ).getFullYear();
  document.getElementById("detail-title").textContent = book.title;
  document.getElementById("detail-author").textContent = `by ${book.author}`;

  // Notes
  const notesEl = document.getElementById("detail-notes");
  const noNotesEl = document.getElementById("detail-no-notes");
  if (book.notes) {
    notesEl.textContent = book.notes;
    notesEl.style.display = "block";
    noNotesEl.style.display = "none";
  } else {
    notesEl.style.display = "none";
    noNotesEl.style.display = "block";
  }

  // Wire Edit and Delete buttons to this specific book
  document.getElementById("detail-edit-btn").onclick = () => {
    closeModal("detail-modal");
    openEdit(book);
  };
  document.getElementById("detail-delete-btn").onclick = () => {
    closeModal("detail-modal");
    confirmDelete(book.id, book.title);
  };

  openModal("detail-modal");
}

/* ----- Edit modal: pre-populate fields ----- */
function openEdit(book) {
  // Fill in text fields
  document.getElementById("edit-title").value = book.title;
  document.getElementById("edit-author").value = book.author;
  document.getElementById("edit-isbn").value = book.isbn || "";
  document.getElementById("edit-notes").value = book.notes || "";

  // Format date for the date input (YYYY-MM-DD)
  if (book.date_read) {
    const d = new Date(book.date_read);
    document.getElementById("edit-date").value = d.toISOString().split("T")[0];
  }

  // Set form action to the correct PATCH route
  document.getElementById("edit-form").action = `/books/${book.id}`;

  // Set rating hidden input, then init star picker with that value
  document.getElementById("edit-rating-val").value = book.rating || 0;
  initStarPicker("edit-stars", "edit-rating-val", book.rating || 0);

  openModal("edit-modal");
}

/* ----- Delete confirmation ----- */
function confirmDelete(id, title) {
  document.getElementById("delete-book-title").textContent = `"${title}"`;
  document.getElementById("delete-form").action = `/books/${id}/delete`;
  openModal("delete-modal");
}

// ============================================================
//  Book title autocomplete (Open Library Search API)
// ============================================================

function initAutocomplete() {
  const titleInput = document.getElementById("add-title");
  const authorInput = document.getElementById("add-author");
  const isbnInput = document.getElementById("add-isbn");
  const suggestions = document.getElementById("add-suggestions");

  let debounceTimer = null;
  let activeIndex = -1; // tracks keyboard-highlighted suggestion

  // Fire search 350ms after the user stops typing
  titleInput.addEventListener("input", () => {
    const query = titleInput.value.trim();
    clearTimeout(debounceTimer);
    activeIndex = -1;

    if (query.length < 2) {
      closeSuggestions();
      return;
    }

    debounceTimer = setTimeout(() => fetchSuggestions(query), 350);
  });

  // Keyboard navigation: ↑ ↓ Enter Escape
  titleInput.addEventListener("keydown", (e) => {
    const items = suggestions.querySelectorAll("li[data-index]");
    if (!items.length) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      activeIndex = Math.min(activeIndex + 1, items.length - 1);
      updateActive(items);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
      updateActive(items);
    } else if (e.key === "Enter" && activeIndex >= 0) {
      e.preventDefault();
      items[activeIndex].click();
    } else if (e.key === "Escape") {
      closeSuggestions();
    }
  });

  // Close when clicking anywhere outside the autocomplete wrapper
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".autocomplete-wrap")) closeSuggestions();
  });

  async function fetchSuggestions(query) {
    showLoading();
    try {
      const url = `https://openlibrary.org/search.json?title=${encodeURIComponent(query)}&limit=6&fields=title,author_name,isbn`;
      const res = await fetch(url);
      const data = await res.json();
      renderSuggestions(data.docs || []);
    } catch (err) {
      console.error("Autocomplete error:", err);
      closeSuggestions();
    }
  }

  function renderSuggestions(docs) {
    suggestions.innerHTML = "";
    const valid = docs.filter((d) => d.title);

    if (valid.length === 0) {
      suggestions.innerHTML = `<li class="suggestion-empty">No results found</li>`;
      suggestions.classList.add("open");
      return;
    }

    valid.forEach((doc, i) => {
      const author = doc.author_name ? doc.author_name[0] : "Unknown author";
      const isbn = doc.isbn ? doc.isbn[0] : "";

      const li = document.createElement("li");
      li.dataset.index = i;
      li.innerHTML = `
        <div class="suggestion-title">${doc.title}</div>
        <div class="suggestion-author">${author}</div>
      `;

      // Clicking a suggestion fills in title, author, ISBN
      li.addEventListener("click", () => {
        titleInput.value = doc.title;
        authorInput.value = author;
        isbnInput.value = isbn;
        closeSuggestions();
        // Move focus to date field to keep the form flow going
        document.querySelector("#add-modal input[name='date_read']").focus();
      });

      suggestions.appendChild(li);
    });

    suggestions.classList.add("open");
    activeIndex = -1;
  }

  function showLoading() {
    suggestions.innerHTML = `<li class="suggestion-loading">Searching…</li>`;
    suggestions.classList.add("open");
  }

  function closeSuggestions() {
    suggestions.classList.remove("open");
    suggestions.innerHTML = "";
    activeIndex = -1;
  }

  function updateActive(items) {
    items.forEach((item, i) =>
      item.classList.toggle("active", i === activeIndex),
    );
    if (activeIndex >= 0)
      items[activeIndex].scrollIntoView({ block: "nearest" });
  }
}

initAutocomplete();
