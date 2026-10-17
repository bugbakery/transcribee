use ndarray::{ArrayD, ShapeBuilder};
use npyz::WriterBuilder;
use std::{
    fs::{self, File, OpenOptions},
    io::Read,
    path::PathBuf,
    process::Command,
    str::FromStr,
    thread::sleep,
    time::Duration,
};

pub fn assert_similiar_to_reference(reference_name: &str, x: ArrayD<f32>, max_mean_delta: f32) {
    let reference = get_reference_data(reference_name);
    let is_similiar = is_similiar(reference.clone(), x.clone(), max_mean_delta);
    let folder = get_reference_folder();
    write_ndarray_to_file(
        &folder.join(reference_name.replace(".npy", "_ours.npy")),
        x.clone(),
    );
    if !is_similiar {
        println!("x: {:?}", &x);
        println!("reference: {:?}", &reference);
        panic!("x is not similiar to reference {reference_name}")
    }
}

pub fn is_similiar(a: ArrayD<f32>, b: ArrayD<f32>, max_mean_delta: f32) -> bool {
    assert_eq!(a.shape(), b.shape());

    let mut max = 0.0;
    let mut sum = 0.0;
    let mut count = 0;
    for ((_ia, a), (_ib, b)) in a.indexed_iter().zip(b.indexed_iter()) {
        let diff = (a - b).abs();
        if diff > max {
            max = diff;
        }
        sum += diff;
        count += 1;
    }
    println!("-> max  deviation: {max}");
    let mean = sum / count as f32;
    println!("-> mean deviation: {mean}");
    mean < max_mean_delta
}

pub fn get_reference_data(name: &str) -> ArrayD<f32> {
    let reference_folder = get_reference_folder();
    read_ndarray_from_file(&reference_folder.join(name))
}

pub fn get_reference_folder() -> PathBuf {
    let reference_folder = PathBuf::from_str("./target/").unwrap();
    let creating_path = reference_folder.join("reference_creating");
    let created_path = reference_folder.join("reference_created");
    while creating_path.exists() {
        sleep(Duration::from_millis(50));
    }
    if created_path.exists() {
        return reference_folder;
    } else {
        File::create(creating_path.clone()).unwrap();
        println!("creating reference files from python");
        let result = Command::new("uv")
            .args([
                "run",
                "python",
                "src/whisper/reference/reference.py",
                "../worker/tests/data/sample.mp3",
            ])
            .status();
        let exitstatus = result.expect("creating reference files failed");
        if !exitstatus.success() {
            fs::remove_file(creating_path).unwrap();
            panic!("creating reference files failed!");
        } else {
            File::create(created_path).unwrap();
            fs::remove_file(creating_path).unwrap();
        }
        return reference_folder;
    }
}

pub fn read_ndarray_from_file(path: &PathBuf) -> ArrayD<f32> {
    let mut f = File::open(path).unwrap();
    let mut buf = Vec::with_capacity(f.metadata().unwrap().len() as usize);
    f.read_to_end(&mut buf).unwrap();
    let reader = npyz::NpyFile::new(&buf[..]).unwrap();
    let shape = reader.shape().to_vec();
    let order = reader.order();
    let data = reader.into_vec::<f32>().unwrap();

    let shape = shape.into_iter().map(|x| x as usize).collect::<Vec<_>>();
    let true_shape = shape.set_f(order == npyz::Order::Fortran);

    ndarray::ArrayD::from_shape_vec(true_shape, data).unwrap()
}

pub fn write_ndarray_to_file(path: &PathBuf, x: ArrayD<f32>) {
    let f: File = OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .open(path)
        .unwrap();
    let shape = x.shape().iter().map(|&x| x as u64).collect::<Vec<_>>();
    let c_order_items = x.iter();
    let mut writer = npyz::WriteOptions::new()
        .default_dtype()
        .shape(&shape)
        .writer(f)
        .begin_nd()
        .unwrap();
    writer.extend(c_order_items).unwrap();
    writer.finish().unwrap();
}
