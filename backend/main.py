"""
AI Project Manager Assistant - CLI Entry Point

Usage:
    python -m backend.main "Your requirement text here"
    python -m backend.main --format json "Your requirement text here"
    python -m backend.main --file requirements.txt
    python -m backend.main --interactive
"""
import argparse
import logging
import sys

from .config.settings import load_team_config, get_settings
from .graph.workflow import build_workflow
from .utils.output_formatter import save_output


def setup_logging(verbose: bool = False) -> None:
    """Configure logging for the application."""
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(
        level=level,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )


def create_initial_state(
    requirement_text: str,
    output_format: str = "markdown",
    team_config_path: str | None = None,
) -> dict:
    """
    Build the initial state dict for the LangGraph workflow.

    @param requirement_text: Natural language requirement input
    @param output_format: Output format - 'markdown' or 'json'
    @param team_config_path: Optional path to team config JSON file
    @returns: Initial state dictionary
    """
    settings = get_settings()
    team_config = load_team_config(team_config_path)

    return {
        "raw_input": requirement_text,
        "requirement": None,
        "subtasks": [],
        "team_config": team_config,
        "has_conflict": False,
        "adjustment_count": 0,
        "max_adjustments": settings.max_adjustments,
        "output_format": output_format,
        "final_output": "",
        "error": None,
    }


def run_workflow(
    requirement_text: str,
    output_format: str = "markdown",
    team_config_path: str | None = None,
) -> str:
    """
    Execute the full AI project manager workflow.

    @param requirement_text: Natural language requirement input
    @param output_format: Output format - 'markdown' or 'json'
    @param team_config_path: Optional path to team config JSON file
    @returns: Generated output string
    """
    initial_state = create_initial_state(requirement_text, output_format, team_config_path)
    workflow = build_workflow()
    result = workflow.invoke(initial_state)

    if result.get("error"):
        raise RuntimeError(f"Workflow failed: {result['error']}")

    return result.get("final_output", "")


def run_interactive() -> None:
    """Run the assistant in interactive mode."""
    print("=" * 60)
    print("  AI Project Manager Assistant")
    print("  Type your requirement and press Enter.")
    print("  Type 'quit' or 'exit' to stop.")
    print("=" * 60)

    while True:
        try:
            print()
            requirement = input("Requirement > ").strip()

            if requirement.lower() in ("quit", "exit", "q"):
                print("Goodbye!")
                break

            if not requirement:
                print("Please enter a requirement.")
                continue

            print("\nProcessing...\n")
            output = run_workflow(requirement)
            print(output)

        except KeyboardInterrupt:
            print("\nGoodbye!")
            break
        except Exception as e:
            print(f"Error: {e}")


def main() -> None:
    """Main entry point for the CLI."""
    parser = argparse.ArgumentParser(
        description="AI Project Manager Assistant - Transform requirements into actionable task plans",
    )
    parser.add_argument(
        "requirement",
        nargs="?",
        help="Requirement text to process",
    )
    parser.add_argument(
        "--format", "-f",
        choices=["markdown", "json"],
        default="markdown",
        help="Output format (default: markdown)",
    )
    parser.add_argument(
        "--file",
        help="Read requirement from a text file",
    )
    parser.add_argument(
        "--output", "-o",
        help="Save output to a file",
    )
    parser.add_argument(
        "--team-config",
        help="Path to team configuration JSON file",
    )
    parser.add_argument(
        "--interactive", "-i",
        action="store_true",
        help="Run in interactive mode",
    )
    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Enable verbose logging",
    )

    args = parser.parse_args()
    setup_logging(args.verbose)

    if args.interactive:
        run_interactive()
        return

    requirement_text = None

    if args.file:
        with open(args.file, "r", encoding="utf-8") as f:
            requirement_text = f.read().strip()
    elif args.requirement:
        requirement_text = args.requirement

    if not requirement_text:
        parser.print_help()
        sys.exit(1)

    try:
        output = run_workflow(
            requirement_text,
            output_format=args.format,
            team_config_path=args.team_config,
        )
        print(output)

        if args.output:
            filepath = save_output(output, args.output)
            print(f"\nOutput saved to: {filepath}")

    except Exception as e:
        logging.error("Failed: %s", e)
        sys.exit(1)


if __name__ == "__main__":
    main()
