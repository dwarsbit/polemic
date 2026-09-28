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
    fn checks_words_from_any_source() {
        let state =
            SpellState::from_words(vec!["haus".to_string(), "buch".to_string()], &[]);
        assert!(state.check_one("Haus"));
        assert!(!state.check_one("Hauss"));
    }
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

    pub fn add(&mut self, word: &str) {
        self.known.insert(word.to_lowercase());
    }
}
