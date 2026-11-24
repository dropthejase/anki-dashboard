-- A small square picture per board. Kept in its own table so listing boards never reads image bytes.
-- `version` is the time it was set, used to make the picture's URL change when the picture does.
CREATE TABLE board_images (
  board_id TEXT PRIMARY KEY REFERENCES boards(id) ON DELETE CASCADE,
  image    BLOB NOT NULL,
  version  INTEGER NOT NULL
) STRICT;
