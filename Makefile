PREFIX ?= /usr/local
BINDIR  = $(PREFIX)/bin
NAME    = optimia

.PHONY: install uninstall

install: bin/$(NAME)
	install -Dm 755 bin/$(NAME) $(DESTDIR)$(BINDIR)/$(NAME)
	@echo "Installed $(NAME) → $(DESTDIR)$(BINDIR)/$(NAME)"

uninstall:
	rm -f $(DESTDIR)$(BINDIR)/$(NAME)
	@echo "Removed $(DESTDIR)$(BINDIR)/$(NAME)"
