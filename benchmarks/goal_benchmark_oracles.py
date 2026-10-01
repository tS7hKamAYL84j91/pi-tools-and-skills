"""Benchmark-only C judge controls; never copied into an agent worktree.

These implement the public contracts, not track reference solutions. Native
preflight must prove the control passes and each fault fails the official suite.
"""

DOMINOES_API = """#include <stddef.h>
#include <stdint.h>
typedef struct { uint16_t first; uint16_t second; } domino_t;
extern int can_chain(size_t domino_count, const domino_t *dominoes);
"""
BOOK_API = """#include <stddef.h>
#include <stdint.h>
extern uint32_t total(size_t basket_count, const uint16_t *basket);
"""
RECTANGLES_API = """#include <stddef.h>
extern int rectangles(const char **strings);
"""

DOMINOES = """#include "api.h"
static unsigned root(unsigned *parent, unsigned v) {
    while (parent[v] != v) { parent[v] = parent[parent[v]]; v = parent[v]; }
    return v;
}
int can_chain(size_t n, const domino_t *stones) {
    if (n == 0) return 1;
    unsigned parent[65536];
    unsigned char degree[65536] = {0};
    unsigned char present[65536] = {0};
    for (unsigned v = 0; v < 65536; v++) parent[v] = v;
    for (size_t i = 0; i < n; i++) {
        unsigned a = stones[i].first, b = stones[i].second;
        degree[a] ^= 1; degree[b] ^= 1;
        present[a] = present[b] = 1;
        parent[root(parent, a)] = root(parent, b);
    }
    unsigned first = root(parent, stones[0].first);
    for (unsigned v = 0; v < 65536; v++) {
        if (degree[v]) return 0;
        if (present[v] && root(parent, v) != first) return 0;
    }
    return 1;
}
"""

BOOK = """#include "api.h"
#include <stdlib.h>
#include <stdint.h>
#include <limits.h>
static const uint32_t prices[] = {0, 800, 1520, 2160, 2560, 3000};
static uint32_t solve(const size_t counts[5], const size_t stride[5], uint32_t *memo) {
    size_t index = 0;
    for (unsigned i = 0; i < 5; i++) index += counts[i] * stride[i];
    if (memo[index] != UINT32_MAX) return memo[index];
    uint32_t best = UINT32_MAX;
    for (unsigned mask = 1; mask < 32; mask++) {
        size_t next[5]; unsigned size = 0; int valid = 1;
        for (unsigned i = 0; i < 5; i++) {
            next[i] = counts[i];
            if (mask & (1u << i)) {
                if (!next[i]) { valid = 0; break; }
                next[i]--; size++;
            }
        }
        if (valid) {
            uint32_t cost = prices[size] + solve(next, stride, memo);
            if (cost < best) best = cost;
        }
    }
    return memo[index] = best;
}
uint32_t total(size_t n, const uint16_t *basket) {
    if (n == 0) return 0;
    size_t counts[5] = {0}, stride[5], states = 1;
    for (size_t i = 0; i < n; i++) counts[basket[i] - 1]++;
    for (unsigned i = 0; i < 5; i++) {
        stride[i] = states;
        if (counts[i] + 1 > SIZE_MAX / states) abort();
        states *= counts[i] + 1;
    }
    if (states > SIZE_MAX / sizeof(uint32_t)) abort();
    uint32_t *memo = malloc(states * sizeof(uint32_t));
    if (!memo) abort();
    for (size_t i = 0; i < states; i++) memo[i] = UINT32_MAX;
    memo[0] = 0;
    uint32_t answer = solve(counts, stride, memo);
    free(memo);
    return answer;
}
"""

GREEDY_BOOK = """#include "api.h"
uint32_t total(size_t n, const uint16_t *basket) {
    const uint32_t prices[] = {0, 800, 1520, 2160, 2560, 3000};
    size_t counts[5] = {0}; uint32_t answer = 0;
    for (size_t i = 0; i < n; i++) counts[basket[i] - 1]++;
    for (;;) {
        unsigned size = 0;
        for (unsigned i = 0; i < 5; i++) if (counts[i]) { counts[i]--; size++; }
        if (!size) return answer;
        answer += prices[size];
    }
}
"""

RECTANGLES = """#include "api.h"
#include <string.h>
static int horizontal(const char *row, size_t left, size_t right) {
    for (size_t c = left + 1; c < right; c++)
        if (row[c] != '-' && row[c] != '+') return 0;
    return 1;
}
static int vertical(const char **rows, size_t top, size_t bottom, size_t c) {
    for (size_t r = top + 1; r < bottom; r++)
        if (rows[r][c] != '|' && rows[r][c] != '+') return 0;
    return 1;
}
int rectangles(const char **rows) {
    size_t height = 0;
    while (rows[height]) height++;
    if (!height) return 0;
    size_t width = strlen(rows[0]); int answer = 0;
    for (size_t top = 0; top < height; top++)
      for (size_t bottom = top + 1; bottom < height; bottom++)
        for (size_t left = 0; left < width; left++)
          for (size_t right = left + 1; right < width; right++) {
            if (rows[top][left] != '+' || rows[top][right] != '+' ||
                rows[bottom][left] != '+' || rows[bottom][right] != '+') continue;
            if (horizontal(rows[top], left, right) && horizontal(rows[bottom], left, right) &&
                vertical(rows, top, bottom, left) && vertical(rows, top, bottom, right)) answer++;
          }
    return answer;
}
"""


def replace_once(source, before, after):
    if source.count(before) != 1:
        raise ValueError("Fault definition must change exactly one location")
    return source.replace(before, after)


def oracle_spec(slug):
    if slug == "dominoes":
        return {"api": DOMINOES_API, "contract": "Return nonzero iff a closed chain exists; the empty set is valid. Do not modify input stones. Values are uint16_t.",
                "reference": DOMINOES, "faults": {
                    "ignores-connectivity": replace_once(DOMINOES, "if (present[v] && root(parent, v) != first) return 0;", "(void)present; (void)first;"),
                    "ignores-odd-degree": replace_once(DOMINOES, "if (degree[v]) return 0;", "(void)degree;"),
                    "rejects-empty": replace_once(DOMINOES, "if (n == 0) return 1;", "if (n == 0) return 0;")}}
    if slug == "book-store":
        return {"api": BOOK_API, "contract": "Return the minimum total price in integer cents. Book IDs are 1 through 5. An empty basket costs zero; its pointer may be NULL. Do not modify the input basket.",
                "reference": BOOK, "faults": {
                    "greedy-largest-group": GREEDY_BOOK,
                    "wrong-two-book-discount": replace_once(BOOK, "{0, 800, 1520, 2160, 2560, 3000}", "{0, 800, 1440, 2160, 2560, 3000}"),
                    "charges-empty-basket": replace_once(BOOK, "if (n == 0) return 0;", "if (n == 0) return 800;")}}
    if slug == "rectangles":
        return {"api": RECTANGLES_API, "contract": "Input is a NULL-terminated array of row pointers; a first NULL means zero rows. Rows are equal-width ASCII strings. Return the rectangle count without modifying the rows.",
                "reference": RECTANGLES, "faults": {
                    "accepts-horizontal-gaps": replace_once(RECTANGLES, "if (row[c] != '-' && row[c] != '+') return 0;", "(void)row;"),
                    "rejects-vertical-crossings": replace_once(RECTANGLES, "if (rows[r][c] != '|' && rows[r][c] != '+') return 0;", "if (rows[r][c] != '|') return 0;"),
                    "misses-unit-height": replace_once(RECTANGLES, "bottom = top + 1", "bottom = top + 2")}}
    raise ValueError("Authored-tests mode currently supports dominoes, book-store and rectangles")
