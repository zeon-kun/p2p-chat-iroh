# Contributing

Thank you for your interest in contributing to iroh relay-test.

## How to contribute

1. Fork the repository and create a branch from `main`.
2. Make your changes — keep commits focused and the diff readable.
3. Run the existing tests before submitting:

   ```bash
   cargo test
   cd simulation && npm test
   ```

4. Open a pull request with a clear description of what you changed and why.

## Reporting bugs

Open a GitHub issue with:

- Steps to reproduce
- Expected vs actual behaviour
- Rust and Node.js versions (`rustc --version`, `node --version`)
- Relevant log output from `logs/`

## Code style

- Rust: `cargo fmt` and `cargo clippy --all-targets` must pass with no warnings.
- TypeScript/React: follow the conventions already present in `web/src/`.
- No unnecessary comments — let the code speak.

## License

By submitting a pull request you agree that your contribution will be licensed under the [MIT License](LICENSE).

## Contact

Muhammad Rafif Tri Risqullah — zeonkunix@gmail.com
