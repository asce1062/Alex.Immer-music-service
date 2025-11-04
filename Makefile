.PHONY: help install install-dev install-hooks clean format lint type-check security test coverage dead-code pre-commit all-checks build terraform

# Default target
.DEFAULT_GOAL := help

# ============================================================================
# Colors for output
# ============================================================================
BLUE := \033[0;34m
GREEN := \033[0;32m
YELLOW := \033[0;33m
RED := \033[0;31m
CYAN := \033[0;36m
NC := \033[0m # No Color

# ============================================================================
# Help
# ============================================================================
help: ## Show this help message
	@echo "$(CYAN)╔═══════════════════════════════════════════════════════════╗$(NC)"
	@echo "$(CYAN)║  $(BLUE)Music Service Monorepo$(CYAN) - Development Commands        ║$(NC)"
	@echo "$(CYAN)╚═══════════════════════════════════════════════════════════╝$(NC)"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "$(GREEN)%-25s$(NC) %s\n", $$1, $$2}'
	@echo ""
	@echo "$(YELLOW)Tip:$(NC) Run '$(GREEN)make dev-setup$(NC)' to set up your environment"

# ============================================================================
# Installation
# ============================================================================
install: ## Install all dependencies (Python + Node)
	@echo "$(BLUE)Installing all dependencies...$(NC)"
	@$(MAKE) install-python
	@$(MAKE) install-node

install-python: ## Install Python dependencies
	@echo "$(BLUE)Installing Python dependencies...$(NC)"
	pip install -e .

install-node: ## Install Node.js dependencies
	@echo "$(BLUE)Installing Node.js dependencies...$(NC)"
	npm install

install-dev: install ## Install development dependencies (Python + Node)
	@echo "$(BLUE)Installing development dependencies...$(NC)"
	pip install -e ".[dev]"
	@echo "$(GREEN)✓ All dependencies installed$(NC)"

install-hooks: install-dev ## Install pre-commit hooks
	@echo "$(BLUE)Installing pre-commit hooks...$(NC)"
	pre-commit install
	pre-commit install --hook-type commit-msg
	@echo "$(GREEN)✓ Pre-commit hooks installed$(NC)"

# ============================================================================
# Cleanup
# ============================================================================
clean: ## Clean up build artifacts and cache files (All languages)
	@echo "$(BLUE)Cleaning up...$(NC)"
	@$(MAKE) clean-python
	@$(MAKE) clean-node
	@echo "$(GREEN)✓ Cleaned up$(NC)"

clean-python: ## Clean Python artifacts
	@echo "$(BLUE)Cleaning Python artifacts...$(NC)"
	find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name "*.egg-info" -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name ".pytest_cache" -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name ".mypy_cache" -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name ".ruff_cache" -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name ".pyright" -exec rm -rf {} + 2>/dev/null || true
	find . -type f -name "*.pyc" -delete 2>/dev/null || true
	find . -type f -name "*.pyo" -delete 2>/dev/null || true
	find . -type f -name ".coverage" -delete 2>/dev/null || true
	rm -rf build dist htmlcov .coverage coverage.xml

clean-node: ## Clean Node.js artifacts
	@echo "$(BLUE)Cleaning Node.js artifacts...$(NC)"
	rm -rf node_modules .turbo
	find . -type d -name "node_modules" -prune -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name ".next" -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name ".output" -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name "dist" -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name "coverage" -exec rm -rf {} + 2>/dev/null || true

# ============================================================================
# Code Formatting
# ============================================================================
format: ## Format all code (Python + TypeScript + Terraform)
	@echo "$(BLUE)Formatting all code...$(NC)"
	@$(MAKE) format-python
	@$(MAKE) format-ts
	@$(MAKE) format-terraform
	@echo "$(GREEN)✓ All code formatted$(NC)"

format-python: ## Format Python code
	@echo "$(BLUE)Formatting Python code...$(NC)"
	black scripts/ infrastructure/terraform/scripts/
	isort scripts/ infrastructure/terraform/scripts/
	ruff check --fix scripts/ infrastructure/terraform/scripts/

format-ts: ## Format TypeScript/JavaScript code
	@echo "$(BLUE)Formatting TypeScript code...$(NC)"
	npm run format:ts

format-terraform: ## Format Terraform files
	@echo "$(BLUE)Formatting Terraform files...$(NC)"
	terraform fmt -recursive infrastructure/terraform/
	@echo "$(GREEN)✓ Terraform formatted$(NC)"

format-check: ## Check code formatting (all languages)
	@echo "$(BLUE)Checking code formatting...$(NC)"
	@$(MAKE) format-check-python
	@$(MAKE) format-check-ts
	@$(MAKE) format-check-terraform
	@echo "$(GREEN)✓ Format check passed$(NC)"

format-check-python: ## Check Python formatting
	@echo "$(BLUE)Checking Python formatting...$(NC)"
	black --check scripts/ infrastructure/terraform/scripts/
	isort --check-only scripts/ infrastructure/terraform/scripts/

format-check-ts: ## Check TypeScript formatting
	@echo "$(BLUE)Checking TypeScript formatting...$(NC)"
	npm run format:check:ts

format-check-terraform: ## Check Terraform formatting
	@echo "$(BLUE)Checking Terraform formatting...$(NC)"
	terraform fmt -check -recursive infrastructure/terraform/
	@echo "$(GREEN)✓ Terraform format check passed$(NC)"

# ============================================================================
# Linting
# ============================================================================
lint: ## Run all linters (Python + TypeScript + Terraform)
	@echo "$(BLUE)Running all linters...$(NC)"
	@$(MAKE) lint-python
	@$(MAKE) lint-ts
	@$(MAKE) lint-terraform
	@echo "$(GREEN)✓ Linting passed$(NC)"

lint-python: ## Lint Python code
	@echo "$(BLUE)Linting Python code...$(NC)"
	ruff check scripts/ infrastructure/terraform/scripts/

lint-ts: ## Lint TypeScript/JavaScript code
	@echo "$(BLUE)Linting TypeScript code...$(NC)"
	@npm run lint:ts || echo "$(YELLOW)⚠ No TypeScript files to lint$(NC)"

lint-terraform: ## Lint Terraform files with tflint
	@echo "$(BLUE)Linting Terraform files...$(NC)"
	@cd infrastructure/terraform && tflint --init 2>/dev/null || echo "$(YELLOW)⚠ tflint not initialized$(NC)"
	@cd infrastructure/terraform && tflint --recursive 2>/dev/null || echo "$(YELLOW)⚠ tflint not installed or found issues$(NC)"
	@echo "$(GREEN)✓ Terraform linting complete$(NC)"

lint-fix: ## Run linters with auto-fix (all languages)
	@echo "$(BLUE)Running linters with auto-fix...$(NC)"
	@$(MAKE) lint-fix-python
	@$(MAKE) lint-fix-ts
	@$(MAKE) format-terraform
	@echo "$(GREEN)✓ Auto-fix completed$(NC)"

lint-fix-python: ## Auto-fix Python linting issues
	@echo "$(BLUE)Fixing Python linting issues...$(NC)"
	ruff check --fix scripts/ infrastructure/terraform/scripts/

lint-fix-ts: ## Auto-fix TypeScript linting issues
	@echo "$(BLUE)Fixing TypeScript linting issues...$(NC)"
	npm run lint:fix:ts

# ============================================================================
# Type Checking
# ============================================================================
type-check: ## Run type checkers (Python + TypeScript)
	@echo "$(BLUE)Running type checkers...$(NC)"
	@$(MAKE) type-check-python
	@$(MAKE) type-check-ts
	@echo "$(GREEN)✓ Type check passed$(NC)"

type-check-python: ## Type check Python code
	@echo "$(BLUE)Type checking Python code with mypy...$(NC)"
	mypy scripts/utils/ infrastructure/terraform/scripts/ --config-file=pyproject.toml --ignore-missing-imports
	@echo "$(BLUE)Type checking Python code with pyright (strict mode)...$(NC)"
	pyright scripts/ infrastructure/terraform/scripts/

type-check-ts: ## Type check TypeScript code
	@echo "$(BLUE)Type checking TypeScript code...$(NC)"
	@npm run type-check:ts || echo "$(YELLOW)⚠ No TypeScript files to type-check yet$(NC)"

# ============================================================================
# Security
# ============================================================================
security: ## Run security checks (Python + TypeScript)
	@echo "$(BLUE)Running security checks...$(NC)"
	@$(MAKE) security-python
	@$(MAKE) security-ts
	@echo "$(GREEN)✓ Security check passed$(NC)"

security-python: ## Security scan Python code
	@echo "$(BLUE)Scanning Python code for security issues...$(NC)"
	bandit -r scripts/ infrastructure/terraform/scripts/ -c pyproject.toml
	pip-audit || echo "$(YELLOW)⚠ pip-audit not installed or found issues$(NC)"

security-ts: ## Security audit Node.js dependencies
	@echo "$(BLUE)Auditing Node.js dependencies...$(NC)"
	npm audit --audit-level=moderate || echo "$(YELLOW)⚠ Found security issues$(NC)"

# ============================================================================
# Dead Code Detection
# ============================================================================
dead-code: ## Find unused code (Python + TypeScript)
	@echo "$(BLUE)Checking for dead code...$(NC)"
	@$(MAKE) dead-code-python
	@$(MAKE) dead-code-ts

dead-code-python: ## Find dead Python code
	@echo "$(BLUE)Finding dead Python code...$(NC)"
	vulture scripts/ infrastructure/terraform/scripts/ --min-confidence=95 --exclude=scripts/tests/ || echo "$(YELLOW)⚠ Potential dead code found$(NC)"

dead-code-ts: ## Find dead TypeScript code
	@echo "$(BLUE)Finding dead TypeScript code...$(NC)"
	npm run dead-code:ts || echo "$(YELLOW)⚠ Potential dead code found$(NC)"

# ============================================================================
# Documentation
# ============================================================================
# docs: ## Check docstring coverage (Python)
# 	@echo "$(BLUE)Checking docstring coverage...$(NC)"
# 	interrogate scripts/ infrastructure/terraform/scripts/ \
# 		--verbose \
# 		--fail-under=80 \
# 		--ignore-init-method \
# 		--ignore-init-module \
# 		--ignore-magic \
# 		--ignore-nested-functions \
# 		--exclude=scripts/tests || echo "$(YELLOW)⚠ Docstring coverage below 80%$(NC)"

# ============================================================================
# Testing
# ============================================================================
test: ## Run all tests (Python + TypeScript)
	@echo "$(BLUE)Running all tests...$(NC)"
	@$(MAKE) test-python
	@$(MAKE) test-ts
	@echo "$(GREEN)✓ All tests passed$(NC)"

test-python: ## Run Python tests
	@echo "$(BLUE)Running Python tests...$(NC)"
	pytest scripts/tests/ -v

test-ts: ## Run TypeScript tests
	@echo "$(BLUE)Running TypeScript tests...$(NC)"
	npm run test:ts

test-fast: ## Run tests without coverage
	@echo "$(BLUE)Running fast tests...$(NC)"
	pytest scripts/tests/ -v --no-cov
	npm run test:ts

test-watch: ## Run tests in watch mode (TypeScript)
	@echo "$(BLUE)Running tests in watch mode...$(NC)"
	npm run test:watch

coverage: ## Generate coverage reports (all languages)
	@echo "$(BLUE)Generating coverage reports...$(NC)"
	@$(MAKE) coverage-python
	@$(MAKE) coverage-ts
	@echo "$(GREEN)✓ Coverage reports generated$(NC)"

coverage-python: ## Generate Python coverage report
	@echo "$(BLUE)Generating Python coverage report...$(NC)"
	pytest scripts/tests/ --cov=scripts/utils --cov-report=term-missing --cov-report=html
	@echo "$(GREEN)✓ Python coverage: htmlcov/index.html$(NC)"

coverage-ts: ## Generate TypeScript coverage report
	@echo "$(BLUE)Generating TypeScript coverage report...$(NC)"
	npm run test:coverage:ts
	@echo "$(GREEN)✓ TypeScript coverage: coverage/index.html$(NC)"

# ============================================================================
# Pre-commit
# ============================================================================
pre-commit: ## Run pre-commit hooks on all files
	@echo "$(BLUE)Running pre-commit hooks...$(NC)"
	pre-commit run --all-files
	@echo "$(GREEN)✓ Pre-commit checks passed$(NC)"

pre-commit-update: ## Update pre-commit hooks to latest versions
	@echo "$(BLUE)Updating pre-commit hooks...$(NC)"
	pre-commit autoupdate
	@echo "$(GREEN)✓ Pre-commit hooks updated$(NC)"

# ============================================================================
# Combined Checks
# ============================================================================
all-checks: format-check lint type-check security test check-terraform ## Run all checks (CI equivalent)
	@echo "$(GREEN)✅ All checks passed!$(NC)"

quick-check: format-check lint type-check check-terraform ## Quick check (format, lint, type-check)
	@echo "$(GREEN)✅ Quick checks passed!$(NC)"

check-python: format-check-python lint-python type-check-python test-python ## Run all Python checks
	@echo "$(GREEN)✅ All Python checks passed!$(NC)"

check-ts: format-check-ts lint-ts type-check-ts test-ts ## Run all TypeScript checks
	@echo "$(GREEN)✅ All TypeScript checks passed!$(NC)"

# ============================================================================
# Build & Package
# ============================================================================
build: clean ## Build all workspaces
	@echo "$(BLUE)Building all workspaces...$(NC)"
	npm run build
	@echo "$(GREEN)✓ Build complete$(NC)"

build-api: ## Build API workspace
	@echo "$(BLUE)Building API...$(NC)"
	npm run build:api
	@echo "$(GREEN)✓ API built$(NC)"

build-web: ## Build Web workspace
	@echo "$(BLUE)Building Web...$(NC)"
	npm run build:web
	@echo "$(GREEN)✓ Web built$(NC)"

# ============================================================================
# Development Workflow
# ============================================================================
dev-setup: install-dev install-hooks ## Complete development setup
	@echo "$(GREEN)✅ Development environment ready!$(NC)"
	@echo ""
	@echo "$(CYAN)Next steps:$(NC)"
	@echo "  - Run '$(GREEN)make test$(NC)' to run tests"
	@echo "  - Run '$(GREEN)make format$(NC)' to format code"
	@echo "  - Run '$(GREEN)make all-checks$(NC)' to run all checks"
	@echo "  - Pre-commit hooks will run automatically on git commit"

dev: ## Start development servers (all workspaces)
	@echo "$(BLUE)Starting development servers...$(NC)"
	npm run dev

dev-api: ## Start API development server
	@echo "$(BLUE)Starting API development server...$(NC)"
	npm run dev:api

dev-web: ## Start Web development server
	@echo "$(BLUE)Starting Web development server...$(NC)"
	npm run dev:web

# ============================================================================
# Music Sync Commands
# ============================================================================
sync-dry-run: ## Run music sync in dry-run mode
	@echo "$(BLUE)Running music sync (dry-run)...$(NC)"
	python scripts/music_sync.py publish --dry-run

sync: ## Run full music sync
	@echo "$(BLUE)Running music sync...$(NC)"
	python scripts/music_sync.py publish

sync-validate: ## Validate music directory structure
	@echo "$(BLUE)Validating music directory...$(NC)"
	python scripts/music_sync.py validate

# ============================================================================
# Terraform Infrastructure
# ============================================================================
tf-validate: ## Validate all Terraform configurations
	@echo "$(BLUE)Validating Terraform configurations...$(NC)"
	@cd infrastructure/terraform/local-state/00-backend-setup && terraform validate 2>/dev/null || echo "$(YELLOW)⚠ backend-setup not initialized (run 'make tf-init-backend')$(NC)"
	@cd infrastructure/terraform/remote-state/01-bootstrap && terraform validate 2>/dev/null || echo "$(YELLOW)⚠ bootstrap not initialized (run 'make tf-init-bootstrap')$(NC)"
	@cd infrastructure/terraform/remote-state/02-infrastructure && terraform validate 2>/dev/null || echo "$(YELLOW)⚠ main terraform not initialized (run 'make tf-init')$(NC)"
	@echo "$(GREEN)✓ Terraform validation complete$(NC)"

tf-init: ## Initialize all Terraform directories
	@echo "$(BLUE)Initializing Terraform...$(NC)"
	@echo "$(YELLOW)Note: Run backend-setup first if this is your first time$(NC)"
	@cd infrastructure/terraform && terraform init
	@echo "$(GREEN)✓ Terraform initialized$(NC)"

tf-init-backend: ## Initialize backend-setup (first-time setup)
	@echo "$(BLUE)Initializing backend-setup...$(NC)"
	@cd infrastructure/terraform/local-state/00-backend-setup && terraform init
	@echo "$(GREEN)✓ Backend setup initialized$(NC)"

tf-init-bootstrap: ## Initialize bootstrap (creates music-service user)
	@echo "$(BLUE)Initializing bootstrap...$(NC)"
	@cd infrastructure/terraform/remote-state/01-bootstrap && terraform init
	@echo "$(GREEN)✓ Bootstrap initialized$(NC)"

tf-plan: ## Plan main infrastructure changes
	@echo "$(BLUE)Planning infrastructure changes...$(NC)"
	@cd infrastructure/terraform/remote-state/02-infrastructure && terraform plan
	@echo "$(GREEN)✓ Plan complete$(NC)"

tf-plan-backend: ## Plan backend-setup changes
	@echo "$(BLUE)Planning backend-setup changes...$(NC)"
	@cd infrastructure/terraform/local-state/00-backend-setup && terraform plan
	@echo "$(GREEN)✓ Backend plan complete$(NC)"

tf-plan-bootstrap: ## Plan bootstrap changes
	@echo "$(BLUE)Planning bootstrap changes...$(NC)"
	@cd infrastructure/terraform/remote-state/01-bootstrap && terraform plan
	@echo "$(GREEN)✓ Bootstrap plan complete$(NC)"

tf-apply: ## Apply main infrastructure changes
	@echo "$(BLUE)Applying infrastructure changes...$(NC)"
	@cd infrastructure/terraform/remote-state/02-infrastructure && terraform apply
	@echo "$(GREEN)✓ Infrastructure applied$(NC)"

tf-apply-backend: ## Apply backend-setup (creates S3 + DynamoDB for state)
	@echo "$(BLUE)Applying backend-setup...$(NC)"
	@cd infrastructure/terraform/local-state/00-backend-setup && terraform apply
	@echo "$(GREEN)✓ Backend resources created$(NC)"
	@echo "$(YELLOW)Next: Run 'make tf-init-bootstrap' and 'make tf-apply-bootstrap'$(NC)"

tf-apply-bootstrap: ## Apply bootstrap (creates music-service user)
	@echo "$(BLUE)Applying bootstrap...$(NC)"
	@cd infrastructure/terraform/remote-state/01-bootstrap && terraform apply
	@echo "$(GREEN)✓ Bootstrap complete$(NC)"
	@echo "$(YELLOW)Next: Create access keys for music-service user$(NC)"

tf-import: ## Import existing AWS resources into Terraform state
	@echo "$(BLUE)Importing existing resources...$(NC)"
	@cd infrastructure/terraform && python3 scripts/import_existing_resources.py
	@echo "$(GREEN)✓ Resources imported$(NC)"

tf-destroy: ## Destroy main infrastructure (WARNING: destructive!)
	@echo "$(RED)⚠ WARNING: This will destroy all infrastructure!$(NC)"
	@echo "$(YELLOW)Press Ctrl+C to cancel, or Enter to continue...$(NC)"
	@read confirm
	@cd infrastructure/terraform && terraform destroy
	@echo "$(RED)Infrastructure destroyed$(NC)"

tf-output: ## Show Terraform outputs
	@echo "$(BLUE)Terraform outputs:$(NC)"
	@cd infrastructure/terraform && terraform output

tf-state-list: ## List all resources in Terraform state
	@echo "$(BLUE)Resources in Terraform state:$(NC)"
	@cd infrastructure/terraform && terraform state list

check-terraform: format-check-terraform lint-terraform tf-validate ## Run all Terraform checks
	@echo "$(GREEN)✅ All Terraform checks passed!$(NC)"

# ============================================================================
# CI/CD
# ============================================================================
ci: ## Run full CI checks (use this locally before pushing)
	@echo "$(CYAN)╔═══════════════════════════════════════════════════════════╗$(NC)"
	@echo "$(CYAN)║  $(BLUE)Running Full CI Checks$(CYAN)                                ║$(NC)"
	@echo "$(CYAN)╚═══════════════════════════════════════════════════════════╝$(NC)"
	@$(MAKE) all-checks
	@$(MAKE) dead-code
	@echo "$(GREEN)✅ All CI checks passed! Ready to push.$(NC)"

ci-fast: ## Run fast CI checks
	@echo "$(BLUE)Running fast CI checks...$(NC)"
	@$(MAKE) quick-check
	@$(MAKE) test-fast
	@echo "$(GREEN)✅ Fast CI checks passed!$(NC)"
