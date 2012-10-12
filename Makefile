REPORTER ?= list
# Flags and arguments for node. Could be "debug" to trigger interactive debug session, or '--debug-brk'
NODE_FLAGS ?= --timeout 3000

.SILENT:

default:
	echo "A build command must be specified."

test: test-queue

test-queue:
	NODE_ENV='test' ./node_modules/mocha/bin/mocha \
    $(NODE_FLAGS) \
		--reporter $(REPORTER) \
		test/queue

.PHONY: test
