// could we explore https://www.npmjs.com/package/columnify
// to simplify the columns/tables? the | - decoration is big
const Table = require('cli-table3');
const colors = require('colors/safe');
const stringLength = require('string-length');
const _ = require('lodash');
const read = require('read');
const ora = require('ora');

const notUndef = s => String(s === undefined ? '' : s).trim();

const unBacktick = s => s.replace(/\n?`+(bash)?/g, '');

const prettyJSONstringify = obj => JSON.stringify(obj, null, '  ');

const markdownLog = str => {
  // turn markdown into something with styles and stuff
  // https://blog.mariusschulz.com/content/images/sublime_markdown_with_syntax_highlighting.png
  console.log(unBacktick(str));
};

// Convert rows from keys to column labels.
const rewriteLabels = (rows, columnDefs) => {
  return rows.map(row => {
    const consumptionRow = {};
    columnDefs.forEach(columnDef => {
      const [label, key, _default] = columnDef;
      const val = _.get(row, key || label, _default);
      consumptionRow[label] = notUndef(val);
    });
    return consumptionRow;
  });
};

const makePlainSingle = row => {
  return _.map(row, (value, key) => {
    return (colors.grey('==') + ' ' + colors.bold(key) + '\n' + value).trim();
  }).join('\n');
};

// An easier way to print rows for copy paste accessibility.
const makePlain = (rows, columnDefs) => {
  return (
    rewriteLabels(rows, columnDefs)
      .map(makePlainSingle)
      .join(colors.grey('\n\n - - - - - - - - - - - - - - - - - - \n\n')) + '\n'
  );
};

const isTooWideForWindow = str => {
  const widestRow = str.split('\n').reduce((coll, row) => {
    if (stringLength(row) > coll) {
      return stringLength(row);
    } else {
      return coll;
    }
  }, 0);

  return widestRow > process.stdout.columns;
};

const ansiTrim = s =>
  _.trim(s, [
    '\r',
    '\n',
    ' '
    // '\u001b[39m',
    // '\u001b[90m',
  ]);

const CHARS = {
  // 'top': '', 'top-mid': '', 'top-left': '', 'top-right': '',
  // 'bottom': ' ', 'bottom-mid': ' ', 'bottom-left': ' ', 'bottom-right': ' '
};

// Similar to makeTable, but prints the column headings in the left-hand column
// and the values in the right-hand column, in rows
const makeRowBasedTable = (rows, columnDefs, { includeIndex = true } = {}) => {
  const tableOptions = {
    chars: CHARS,
    style: {
      compact: true
    }
  };
  const table = new Table(tableOptions);

  const maxLabelLength = _.reduce(
    columnDefs,
    (maxLength, columnDef) => {
      if (columnDef[0] && stringLength(columnDef[0]) > maxLength) {
        return stringLength(columnDef[0]);
      }
      return maxLength;
    },
    1
  );
  const widthForValue = process.stdout.columns - maxLabelLength - 15; // The last bit accounts for some padding and borders
  if (widthForValue < 1) {
    return makePlain(rows, columnDefs); // There's not enough space to display the table
  }

  rows.forEach((row, index) => {
    if (includeIndex) {
      table.push([{ colSpan: 2, content: colors.grey(`= ${index + 1} =`) }]);
    }

    columnDefs.forEach(columnDef => {
      const consumptionRow = {};
      const [label, key, _default] = columnDef;
      let val = _.get(row, key || label, _default);
      val = notUndef(val);

      if (stringLength(val) > widthForValue) {
        try {
          val = prettyJSONstringify(JSON.parse(val));
        } catch (err) {
          // Wasn't JSON, so splice in newlines so that word wraping works properly
          let rest = val;
          val = '';
          while (stringLength(rest) > 0) {
            val += rest.slice(0, widthForValue);
            if (val.indexOf('\n') === -1) {
              val += '\n';
            }
            rest = rest.slice(widthForValue);
          }
        }
      }
      let colLabel = '    ' + colors.bold(label);
      if (!includeIndex) {
        colLabel = colors.bold(label) + '   ';
      }
      consumptionRow[colLabel] = val.trim();
      table.push(consumptionRow);
    });

    if (index < rows.length - 1) {
      table.push([{ colSpan: 2, content: '  ' }]);
    }
  });

  const strTable = ansiTrim(table.toString());

  if (isTooWideForWindow(strTable)) {
    return makePlain(rows, columnDefs);
  }

  return strTable;
};

// Wraps the cli-table3 library. Rows is an array of objects, columnDefs
// an ordered sub-array [[label, key, (optional_default)], ...].
const makeTable = (rows, columnDefs) => {
  const tableOptions = {
    head: columnDefs.map(([label]) => label),
    chars: CHARS,
    style: {
      compact: true,
      head: ['bold']
    }
  };
  const table = new Table(tableOptions);

  rows.forEach(row => {
    const consumptionRow = [];
    columnDefs.forEach(columnDef => {
      const [label, key, _default] = columnDef;
      const val = _.get(row, key || label, _default);
      consumptionRow.push(notUndef(val));
    });
    table.push(consumptionRow);
  });

  const strTable = ansiTrim(table.toString());

  if (isTooWideForWindow(strTable)) {
    return makeRowBasedTable(rows, columnDefs, { includeIndex: false });
  }

  return strTable;
};

const makeJSON = (rows, columnDefs) =>
  prettyJSONstringify(rewriteLabels(rows, columnDefs));
const makeRawJSON = rows => prettyJSONstringify(rows);

const makeSmall = rows => {
  const longestRow = _.max(rows.map(r => r.name.length));
  let res = [];

  rows.forEach(row => {
    res.push(
      `  ${row.name}${' '.repeat(longestRow - row.name.length + 1)} # ${
        row.help
      }`
    );
  });

  return res.join('\n');
};

const DEFAULT_STYLE = 'table';
const formatStyles = {
  plain: makePlain,
  json: makeJSON,
  raw: makeRawJSON,
  row: makeRowBasedTable,
  table: makeTable,
  small: makeSmall
};

const printData = (
  rows,
  columnDefs,
  ifEmptyMessage = '',
  useRowBasedTable = false
) => {
  const formatStyle =
    (global.argOpts || {}).format || (useRowBasedTable ? 'row' : DEFAULT_STYLE);
  const formatter = formatStyles[formatStyle] || formatStyles[DEFAULT_STYLE];
  if (rows && !rows.length) {
    if (['json', 'raw'].includes(formatStyle)) {
      console.log([]);
    } else {
      console.log(ifEmptyMessage);
    }
  } else {
    console.log(formatter(rows, columnDefs));
  }
};

// single global instance of the spinner
const spinner = ora();

const startSpinner = msg => {
  spinner.start(msg);
};

const endSpinner = (success = true, message) => {
  // only stop if it was started in the first place
  if (!spinner.isSpinning) {
    return;
  }

  if (success) {
    spinner.succeed(message);
  } else {
    spinner.fail(message);
  }
};

// Get input from a user.
const getInput = (question, { secret = false } = {}) => {
  return new Promise((resolve, reject) => {
    read(
      {
        prompt: question,
        silent: secret,
        replace: secret ? '*' : undefined
      },
      (err, result) => {
        if (err) {
          reject(err);
        }
        resolve(result);
      }
    );
  });
};

const hasAccepted = answer =>
  answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes';

const hasRejected = answer =>
  answer.toLowerCase() === 'n' || answer.toLowerCase() === 'no';

const getYesNoInput = (question, showCtrlC = true) => {
  let message = question + ' (y/n) ';
  if (showCtrlC) {
    message += '(Ctrl-C to cancel) ';
  }
  return getInput(message).then(answer => {
    const yes = hasAccepted(answer);
    const no = hasRejected(answer);
    if (!yes && !no) {
      throw new Error('That answer is not valid. Please try "y" or "n".');
    }
    return yes;
  });
};

module.exports = {
  formatStyles,
  getInput,
  getYesNoInput,
  makeRowBasedTable,
  makeTable,
  markdownLog,
  prettyJSONstringify,
  printData,
  endSpinner,
  startSpinner
};
