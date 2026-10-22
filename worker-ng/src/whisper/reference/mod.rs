use anyhow::Result;
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

pub fn is_similiar_to_reference(
    reference_name: &str,
    ours_name: &str,
    x: ArrayD<f32>,
    acceptable_max_error: f32,
) -> bool {
    let ours_name = reference_name.replace(".npy", &format!("_{ours_name}.npy"));
    let reference = get_reference_data(reference_name).unwrap();
    assert_eq!(
        reference.shape(),
        x.shape(),
        "shapes dont match {reference_name}.shape() != {ours_name}.shape()"
    );
    let (mean_error, max_error) = get_mean_and_max_error(reference.clone(), x.clone());
    let folder = get_reference_folder();
    write_ndarray_to_file(&folder.join(&ours_name), x.clone());
    if max_error <= acceptable_max_error {
        println!(
            "PASS: {ours_name} is similiar to {reference_name} (mean error: {mean_error}; max_error: {max_error} <= {acceptable_max_error})"
        );
        true
    } else {
        println!(
            "FAIL: {ours_name} is not similiar to {reference_name} (mean error: {mean_error} ; max_error: {max_error} > {acceptable_max_error})"
        );
        false
    }
}

pub fn get_mean_and_max_error(a: ArrayD<f32>, b: ArrayD<f32>) -> (f32, f32) {
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
    let mean = sum / count as f32;
    (mean, max)
}

pub fn get_reference_data(name: &str) -> Result<ArrayD<f32>> {
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

pub fn read_ndarray_from_file(path: &PathBuf) -> Result<ArrayD<f32>> {
    let mut f = File::open(path)?;
    let mut buf = Vec::with_capacity(f.metadata()?.len() as usize);
    f.read_to_end(&mut buf)?;
    let reader = npyz::NpyFile::new(&buf[..])?;
    let shape = reader.shape().to_vec();
    let order = reader.order();
    let data = reader.into_vec::<f32>()?;

    let shape = shape.into_iter().map(|x| x as usize).collect::<Vec<_>>();
    let true_shape = shape.set_f(order == npyz::Order::Fortran);

    Ok(ndarray::ArrayD::from_shape_vec(true_shape, data)?)
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
