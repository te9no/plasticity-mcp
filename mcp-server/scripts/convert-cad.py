"""Local STEP/IGES exchange using OCCT. Geometry only; not assembly metadata."""
import json
import sys
from pathlib import Path
from OCP.IFSelect import IFSelect_RetDone
from OCP.STEPControl import STEPControl_Reader, STEPControl_Writer, STEPControl_AsIs
from OCP.IGESControl import IGESControl_Reader, IGESControl_Writer

source, destination = map(Path, sys.argv[1:3])
if not source.is_file() or destination.exists():
    raise ValueError("Input must exist and output must not exist")
kind = source.suffix.lower()
if kind in (".step", ".stp") and destination.suffix.lower() in (".igs", ".iges"):
    reader = STEPControl_Reader()
    writer = IGESControl_Writer("MM", 1)
elif kind in (".igs", ".iges") and destination.suffix.lower() in (".step", ".stp"):
    reader = IGESControl_Reader()
    writer = STEPControl_Writer()
else:
    raise ValueError("Only STEP to IGES or IGES to STEP conversion is supported")
if reader.ReadFile(str(source)) != IFSelect_RetDone:
    raise ValueError("CAD file could not be parsed")
if reader.TransferRoots() <= 0:
    raise ValueError("CAD file contains no transferable geometry")
shape = reader.OneShape()
if shape.IsNull():
    raise ValueError("CAD transfer produced empty geometry")
if isinstance(writer, IGESControl_Writer):
    if not writer.AddShape(shape):
        raise ValueError("IGES transfer failed")
    writer.ComputeModel()
    success = writer.Write(str(destination))
else:
    if writer.Transfer(shape, STEPControl_AsIs) != IFSelect_RetDone:
        raise ValueError("STEP transfer failed")
    success = writer.Write(str(destination)) == IFSelect_RetDone
if not success or not destination.is_file() or destination.stat().st_size == 0:
    raise ValueError("CAD writer failed")
print(json.dumps({"path": str(destination), "bytes": destination.stat().st_size, "backend": "Open CASCADE 7.9.3"}))
