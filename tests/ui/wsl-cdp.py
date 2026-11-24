import asyncio
import sys

CONNECT = """
const socket = require('node:net').connect(+process.argv[1], '127.0.0.1');
process.stdin.pipe(socket).pipe(process.stdout);
socket.on('close', () => process.exit());
socket.on('error', () => process.exit(1));
"""

async def copy(reader, writer):
    while chunk := await reader.read(65536):
        writer.write(chunk)
        await writer.drain()

async def main(port):
    async def handle(reader, writer):
        child = await asyncio.create_subprocess_exec(
            'node.exe', '-e', CONNECT, str(port),
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE)
        tasks = [asyncio.create_task(copy(reader, child.stdin)),
                 asyncio.create_task(copy(child.stdout, writer))]
        try:
            await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        finally:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            writer.close()
            child.stdin.close()
            await child.wait()

    server = await asyncio.start_server(handle, '127.0.0.1', port)
    print('ready', flush=True)
    async with server:
        await asyncio.get_running_loop().run_in_executor(None, sys.stdin.buffer.read, 1)

asyncio.run(main(int(sys.argv[1])))
