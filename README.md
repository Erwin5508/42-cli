# 42-cli

Interactive tester CLI for the 42 Common Core and the Python Piscine. Runs subject-compliance checks, the libft / ft_printf / get_next_line testers, and norminette from a single menu — plus testers for the seven Python data-engineering modules (Growing Code, Garden Guardian, Data Quest, Code Cultivation, Code Nexus, The Codex, Data Archivist) with flake8 and mypy.

The Python testers need Python 3.10+ on your PATH; `flake8` and `mypy` are used when installed (`pip install flake8 mypy`).

THIS TESTER IS ON BETA, IF ANY BUG IS FOUND PLEASE SEND A MESSAGE TO gomez2680 ON DISCORD IN ORDER FOR THE BUG TO BE REMOVED!!! :))))

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/brunogo25/42-cli/main/install.sh | bash
```

Re-run the same command to upgrade.

Requires Node.js 18+.

### Alternatives

```sh
npm install -g github:brunogo25/42-cli
```

Or clone and link:

```sh
git clone https://github.com/brunogo25/42-cli.git ~/.42-cli
ln -s ~/.42-cli/bin/42.js ~/.local/bin/42
```

## Usage

```sh
42
```

Pick a project from the menu. From inside a libft directory, the CLI auto-detects the project.

## Uninstall

```sh
rm -f ~/.local/bin/42
rm -rf ~/.local/share/42-cli
```

## License

MIT
