use std::collections::HashSet;

/// Bundled English word list (dwyl/english-words, words_alpha.txt,
/// https://github.com/dwyl/english-words). All lowercase, one word per line.
const WORDS: &str = include_str!("../assets/words-en.txt");

/// Minimum frequency for a downloaded word to count as correctly spelled;
/// filters one-off typos from the subtitle-derived lists.
pub const MIN_WORD_FREQUENCY: u64 = 5;

/// Parse a hermitdave/FrequencyWords list ("word count" per line), keeping
/// words at or above the minimum frequency.
pub fn parse_frequency_list(content: &str) -> Vec<String> {
    let mut words = Vec::new();
    for line in content.lines() {
        let mut parts = line.split_whitespace();
        let (word, count) = (parts.next(), parts.next());
        if let (Some(word), Some(count)) = (word, count) {
            if count.parse::<u64>().unwrap_or(0) >= MIN_WORD_FREQUENCY {
                words.push(word.to_lowercase());
            }
        }
    }
    words
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_frequency_lists_with_threshold() {
        let list = "der 100\ntraurig 12\neinmal 5\ntypo 4\nandere 1\n";
        let words = parse_frequency_list(list);
        assert_eq!(words, vec!["der", "traurig", "einmal"]);
    }

    #[test]
    fn suggests_close_words_in_the_original_case() {
        let words = ["world", "word", "would", "wild", "house", "ward"];
        let state = SpellState::from_words(words.iter().map(|w| w.to_string()), &[]);
        // One swap away first; then two-edit ties, same length first.
        assert_eq!(state.suggest("wrold", 3), vec!["world", "would", "wild"]);
        assert_eq!(state.suggest("Wrold", 1), vec!["World"]);
        assert!(state.suggest("zzzzzz", 3).is_empty());
        let words = ["tea", "tech", "ted", "the", "teh"];
        let state = SpellState::from_words(words.iter().map(|w| w.to_string()), &[]);
        assert_eq!(state.suggest("Teh", 1), vec!["The"]);
    }

    #[test]
    fn measures_edits_with_swaps() {
        let chars = |s: &str| s.chars().collect::<Vec<_>>();
        assert_eq!(edit_distance(&chars("teh"), &chars("the"), 2), Some(1));
        assert_eq!(edit_distance(&chars("cat"), &chars("dog"), 2), None);
        assert_eq!(edit_distance(&chars("mädchen"), &chars("madchen"), 2), Some(1));
    }

    #[test]
    fn checks_words_from_any_source() {
        let state =
            SpellState::from_words(vec!["haus".to_string(), "buch".to_string()], &[]);
        assert!(state.check_one("Haus"));
        assert!(!state.check_one("Hauss"));
    }
}

/// Optimal string alignment distance, or None when above `max`.
fn edit_distance(a: &[char], b: &[char], max: usize) -> Option<usize> {
    let mut prev2: Vec<usize> = Vec::new();
    let mut prev: Vec<usize> = (0..=b.len()).collect();
    for i in 1..=a.len() {
        let mut row = vec![i; b.len() + 1];
        let mut best = row[0];
        for j in 1..=b.len() {
            let cost = usize::from(a[i - 1] != b[j - 1]);
            row[j] = (prev[j] + 1).min(row[j - 1] + 1).min(prev[j - 1] + cost);
            if i > 1 && j > 1 && a[i - 1] == b[j - 2] && a[i - 2] == b[j - 1] {
                row[j] = row[j].min(prev2[j - 2] + 1);
            }
            best = best.min(row[j]);
        }
        if best > max {
            return None;
        }
        prev2 = std::mem::replace(&mut prev, row);
    }
    Some(prev[b.len()]).filter(|d| *d <= max)
}

/// A dictionary word in the misspelled word's case: Capitalized or
/// ALL CAPS stay so.
fn match_case(original: &str, word: &str) -> String {
    let mut chars = original.chars();
    let first_upper = chars.next().is_some_and(char::is_uppercase);
    if first_upper && original.chars().count() > 1 && original.chars().all(|c| !c.is_lowercase()) {
        return word.to_uppercase();
    }
    if first_upper {
        let mut out = String::new();
        let mut rest = word.chars();
        if let Some(c) = rest.next() {
            out.extend(c.to_uppercase());
        }
        out.extend(rest);
        return out;
    }
    word.to_string()
}

const CONTRACTION_SUFFIXES: [&str; 8] = ["s", "t", "re", "ve", "ll", "d", "m", "er"];

pub struct SpellState {
    known: HashSet<String>,
}

impl SpellState {
    pub fn new(user_words: &[String]) -> Self {
        Self::from_words(
            WORDS.lines().map(|word| word.trim().to_lowercase()),
            user_words,
        )
    }

    /// Build a spell state from any word source (bundled or downloaded).
    pub fn from_words<I>(words: I, user_words: &[String]) -> Self
    where
        I: IntoIterator<Item = String>,
    {
        let mut known: HashSet<String> = words.into_iter().collect();
        for word in user_words {
            known.insert(word.to_lowercase());
        }
        Self { known }
    }

    pub fn check(&self, words: &[String]) -> Vec<bool> {
        words.iter().map(|word| self.check_one(word)).collect()
    }

    fn check_one(&self, word: &str) -> bool {
        let lower = word.to_lowercase();
        if self.known.contains(&lower) {
            return true;
        }
        // Contractions ("don't" -> "don" + "t"): accept known stem + suffix.
        if let Some((stem, suffix)) = lower.split_once('\'') {
            if self.known.contains(stem) && CONTRACTION_SUFFIXES.contains(&suffix) {
                return true;
            }
        }
        false
    }

    /// Up to `limit` known words close to `word` (at most two edits:
    /// insert, delete, substitute, or swap two neighbours), closest
    /// first; among equals, the same letters reordered (the commonest
    /// typo), then the same first letter, then the same length, then
    /// alphabetical. Capitalization follows the misspelled word.
    pub fn suggest(&self, word: &str, limit: usize) -> Vec<String> {
        let target: Vec<char> = word.to_lowercase().chars().collect();
        let first = target.first().copied();
        let mut sorted_target = target.clone();
        sorted_target.sort_unstable();
        let mut found: Vec<(usize, bool, bool, usize, &String)> = Vec::new();
        for candidate in &self.known {
            let len = candidate.chars().count();
            if len.abs_diff(target.len()) > 2 || candidate.contains('\'') {
                continue;
            }
            let chars: Vec<char> = candidate.chars().collect();
            if let Some(distance) = edit_distance(&target, &chars, 2) {
                if distance > 0 {
                    let mut sorted = chars.clone();
                    sorted.sort_unstable();
                    found.push((
                        distance,
                        sorted != sorted_target,
                        chars.first().copied() != first,
                        len.abs_diff(target.len()),
                        candidate,
                    ));
                }
            }
        }
        found.sort();
        found
            .into_iter()
            .take(limit)
            .map(|(.., candidate)| match_case(word, candidate))
            .collect()
    }

    pub fn add(&mut self, word: &str) {
        self.known.insert(word.to_lowercase());
    }
}
