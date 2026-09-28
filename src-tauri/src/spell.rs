use std::collections::HashSet;

/// Bundled English word list (dwyl/english-words, words_alpha.txt,
/// https://github.com/dwyl/english-words). All lowercase, one word per line.
const WORDS: &str = include_str!("../assets/words-en.txt");

const CONTRACTION_SUFFIXES: [&str; 8] = ["s", "t", "re", "ve", "ll", "d", "m", "er"];

pub struct SpellState {
    known: HashSet<String>,
}

impl SpellState {
    pub fn new(user_words: &[String]) -> Self {
        let mut known: HashSet<String> = WORDS
            .lines()
            .map(|word| word.trim().to_lowercase())
            .collect();
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
