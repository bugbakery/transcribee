goals: 
- transcribe audio of arbitrary length while consuming less than 4GB of memory
- precise eta estimations and progress reporting for downloading and inference
- decent performance on low-end hardware

# Development
This folder contains a `cargo` project for the rust code as well as a `uv` project
for the python code. The python code is only needed to convert models and produce reference
outputs during testing and is not needed during runtime.