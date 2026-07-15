const Student = require('../Models/Student');
const Question = require('../Models/Question');
const Batch = require('../Models/Batch');

// @desc    Delete multiple students
// @route   DELETE /api/admin/students
// @access  Private/Admin
const deleteStudents = async (req, res) => {
  try {
    const { studentIds } = req.body;
    if (!studentIds || !Array.isArray(studentIds) || studentIds.length === 0) {
      return res.status(400).json({ message: 'Please provide an array of student IDs to delete' });
    }
    const result = await Student.deleteMany({ _id: { $in: studentIds } });
    res.json({ message: `Successfully deleted ${result.deletedCount} students` });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error while deleting students' });
  }
};

// @desc    Get Admin Dashboard Stats
// @route   GET /api/admin/stats
// @access  Private/Admin
const getDashboardStats = async (req, res) => {
  try {
    const totalStudents = await Student.countDocuments();
    const testSubmissions = await Student.countDocuments({ testSubmitted: true });
    
    // Aggregate average and high scores
    const scoreStats = await Student.aggregate([
      { $match: { testSubmitted: true } },
      { 
        $group: {
          _id: null,
          averageScore: { $avg: "$score" },
          highScore: { $max: "$score" }
        }
      }
    ]);

    // Aggregate student counts by set
    const setDistribution = await Student.aggregate([
      {
        $group: {
          _id: "$assignedSet",
          count: { $sum: 1 }
        }
      }
    ]);

    const setCounts = { A: 0, B: 0, C: 0, D: 0 };
    setDistribution.forEach(dist => {
      if (dist._id) {
        setCounts[dist._id] = dist.count;
      }
    });

    const averageScore = scoreStats.length > 0 ? Math.round(scoreStats[0].averageScore * 10) / 10 : 0;
    const highScore = scoreStats.length > 0 ? scoreStats[0].highScore : 0;

    res.json({
      totalStudents,
      testSubmissions,
      averageScore,
      highScore,
      setCounts
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error retrieving dashboard statistics' });
  }
};

// @desc    Get all students and their submissions
// @route   GET /api/admin/students
// @access  Private/Admin
const getStudentSubmissions = async (req, res) => {
  try {
    const students = await Student.find().select('-password').sort({ createdAt: -1 });
    res.json(students);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error retrieving student submissions' });
  }
};

// @desc    Reset student's test status to allow retaking
// @route   POST /api/admin/students/:id/reset
// @access  Private/Admin
const resetStudentTest = async (req, res) => {
  try {
    const studentId = req.params.id;
    const student = await Student.findById(studentId);

    if (!student) {
      return res.status(404).json({ message: 'Student not found' });
    }

    student.testStarted = false;
    student.testStartedAt = null;
    student.testSubmitted = false;
    student.testSubmittedAt = null;
    student.score = 0;
    student.answers = [];

    await student.save();
    res.json({ message: 'Student test status reset successfully', student });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error resetting student test' });
  }
};

// @desc    Get all batches
// @route   GET /api/admin/batches
// @access  Private/Admin
const getBatches = async (req, res) => {
  try {
    const batches = await Batch.find().sort({ name: 1 });
    res.json(batches);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error fetching batches' });
  }
};

// @desc    Delete a batch (and unassign all its students)
// @route   DELETE /api/admin/batches/:name
// @access  Private/Admin
const deleteBatch = async (req, res) => {
  try {
    const { name } = req.params;
    const batch = await Batch.findOne({ name });
    if (!batch) return res.status(404).json({ message: 'Batch not found' });
    
    // Count how many students are in this batch before unassigning
    const affectedCount = await Student.countDocuments({ batch: name });
    
    // Unassign all students in this batch (setting to 'Unassigned')
    await Student.updateMany({ batch: name }, { $set: { batch: 'Unassigned', testAllowed: false } });
    await Batch.deleteOne({ name });
    
    res.json({ message: `Batch "${name}" deleted and ${affectedCount} students unassigned.` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error deleting batch' });
  }
};

// @desc    Create a new batch
// @route   POST /api/admin/batches
// @access  Private/Admin
const createBatch = async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'Batch name is required' });
    }
    const nameTrimmed = name.trim();
    const exists = await Batch.findOne({ name: nameTrimmed });
    if (exists) {
      return res.status(400).json({ message: 'Batch already exists' });
    }
    const batch = new Batch({ name: nameTrimmed });
    await batch.save();
    res.status(201).json(batch);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error creating batch' });
  }
};

// @desc    Assign selected students to batch
// @route   POST /api/admin/students/assign-batch
// @access  Private/Admin
const assignStudentsBatch = async (req, res) => {
  try {
    const { studentIds, batchName } = req.body;
    if (!studentIds || !Array.isArray(studentIds) || studentIds.length === 0) {
      return res.status(400).json({ message: 'Please select students to assign' });
    }
    if (!batchName) {
      return res.status(400).json({ message: 'Batch name is required' });
    }
    await Student.updateMany(
      { _id: { $in: studentIds } },
      { $set: { batch: batchName } }
    );
    res.json({ message: `Successfully assigned ${studentIds.length} students to batch ${batchName}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error assigning batch' });
  }
};

// @desc    Remove a student from their batch
// @route   POST /api/admin/students/:id/remove-batch
// @access  Private/Admin
const removeStudentFromBatch = async (req, res) => {
  try {
    const student = await Student.findById(req.params.id);
    if (!student) return res.status(404).json({ message: 'Student not found' });
    student.batch = 'Unassigned';
    await student.save();
    res.json({ message: `${student.name} has been removed from their batch.` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error removing student from batch' });
  }
};

// @desc    Start test for selected students
// @route   POST /api/admin/students/start-test
// @access  Private/Admin
const startTestForStudents = async (req, res) => {
  try {
    const { studentIds } = req.body;
    if (!studentIds || !Array.isArray(studentIds) || studentIds.length === 0) {
      return res.status(400).json({ message: 'Please select students to activate exam' });
    }
    await Student.updateMany(
      { _id: { $in: studentIds }, testSubmitted: { $ne: true } },
      { 
        $set: { 
          testAllowed: true,
          testStarted: false,
          testSubmitted: false,
          score: 0,
          answers: []
        }
      }
    );
    res.json({ message: `Successfully activated and reset exam access for ${studentIds.length} students.` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error starting tests' });
  }
};

// @desc    Stop test for selected students
// @route   POST /api/admin/students/stop-test
// @access  Private/Admin
const stopTestForStudents = async (req, res) => {
  try {
    const { studentIds } = req.body;
    if (!studentIds || !Array.isArray(studentIds) || studentIds.length === 0) {
      return res.status(400).json({ message: 'Please select students to deactivate exam' });
    }
    await Student.updateMany(
      { _id: { $in: studentIds } },
      { $set: { testAllowed: false } }
    );
    res.json({ message: `Successfully deactivated exam access for ${studentIds.length} students.` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error stopping tests' });
  }
};

// @desc    Start/configure exam for a batch
// @route   POST /api/admin/batches/:name/start-exam
// @access  Private/Admin
const startExamForBatch = async (req, res) => {
  try {
    const { name } = req.params;
    const { totalQuestionsToServe, shuffleQuestions, shuffleOptions } = req.body;

    const batch = await Batch.findOne({ name });
    if (!batch) {
      return res.status(404).json({ message: 'Batch not found' });
    }

    batch.testActive = true;
    if (totalQuestionsToServe !== undefined) batch.totalQuestionsToServe = Number(totalQuestionsToServe);
    if (shuffleQuestions !== undefined) batch.shuffleQuestions = !!shuffleQuestions;
    if (shuffleOptions !== undefined) batch.shuffleOptions = !!shuffleOptions;

    await batch.save();

    // Activate exam for all students in this batch who haven't already submitted it
    await Student.updateMany(
      { batch: name, testSubmitted: { $ne: true } },
      { 
        $set: { 
          testAllowed: true,
          testStarted: false,
          testSubmitted: false,
          score: 0,
          answers: []
        }
      }
    );

    res.json({ message: `Successfully started exam for batch "${name}" with ${batch.totalQuestionsToServe} questions.`, batch });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error starting batch exam' });
  }
};

// @desc    Stop/deactivate exam for a batch
// @route   POST /api/admin/batches/:name/stop-exam
// @access  Private/Admin
const stopExamForBatch = async (req, res) => {
  try {
    const { name } = req.params;

    const batch = await Batch.findOne({ name });
    if (!batch) {
      return res.status(404).json({ message: 'Batch not found' });
    }

    batch.testActive = false;
    await batch.save();

    // Deactivate exam for all students in this batch
    await Student.updateMany(
      { batch: name },
      { $set: { testAllowed: false } }
    );

    res.json({ message: `Successfully stopped exam for batch "${name}".`, batch });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error stopping batch exam' });
  }
};

module.exports = {
  getDashboardStats,
  getStudentSubmissions,
  resetStudentTest,
  getBatches,
  createBatch,
  deleteBatch,
  assignStudentsBatch,
  removeStudentFromBatch,
  startTestForStudents,
  stopTestForStudents,
  startExamForBatch,
  stopExamForBatch,
  deleteStudents
};
